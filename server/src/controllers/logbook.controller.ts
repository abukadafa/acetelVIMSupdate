import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Logbook from '../models/Logbook.model';
import Student from '../models/Student.model';
import User from '../models/User.model';
import Notification from '../models/notification.model';
import { io } from '../index';

export async function getLogbookEntries(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId, status, week } = req.query;
    let targetStudentId = studentId;

    if (req.user!.role === 'student' && !targetStudentId) {
      const student = await Student.findOne({ user: req.user!.id });
      if (!student) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }
      targetStudentId = student._id.toString();
    }

    let query: any = {};
    if (targetStudentId) query.student = targetStudentId;
    if (status) query.status = status;
    if (week) query.weekNumber = Number(week);

    const entries = await Logbook.find(query)
      .populate({
        path: 'student',
        populate: { path: 'user', select: 'firstName lastName' }
      })
      .sort({ entryDate: -1 });

    res.json({ entries });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function createLogbookEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { 
      entryDate, activities, toolsUsed, skillsLearned, 
      challenges, solutions, weekNumber, isOfflineSync 
    } = req.body;
    
    const student = await Student.findOne({ user: req.user!.id });
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const existing = await Logbook.findOne({ student: student._id, entryDate });
    if (existing) {
      res.status(409).json({ error: 'Entry already exists for this date' });
      return;
    }

    // Process attachments from Multer if any
    const attachments = (req.files as Express.Multer.File[])?.map(f => `/uploads/logbooks/${f.filename}`) || [];

    const entry = new Logbook({
      student: student._id,
      tenant: student.tenant,
      entryDate,
      weekNumber: weekNumber || 1,
      activities,
      toolsUsed,
      skillsLearned,
      challenges,
      solutions,
      status: 'submitted',
      isOfflineSync: !!isOfflineSync,
      attachments
    });

    await entry.save();

    // Notify supervisor
    if (student.supervisor) {
      const notification = new Notification({
        user: student.supervisor,
        title: 'New Logbook Entry',
        message: `Student ${student.matricNumber} submitted a logbook entry for ${new Date(entryDate).toLocaleDateString()}`,
        type: 'info'
      });
      await notification.save();
      io.to(`user:${student.supervisor}`).emit('notification', { 
        title: notification.title, 
        message: notification.message 
      });
    }

    res.status(201).json({ message: 'Logbook entry submitted', id: entry._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function reviewLogbookEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { supervisorComment, supervisorRating, status } = req.body;
    const entry = await Logbook.findById(req.params.id).populate('student');
    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    entry.supervisorComment = supervisorComment;
    entry.supervisorRating = supervisorRating;
    entry.status = status || 'approved';
    entry.isSupervisorSigned = true;
    entry.supervisorSignedAt = new Date();
    
    await entry.save();

    // Notify student
    const student = entry.student as any;
    const notification = new Notification({
      user: student.user,
      title: 'Logbook Update',
      message: entry.status === 'approved' 
        ? 'Your logbook entry was approved' 
        : `Management requested a revision on your ${new Date(entry.entryDate).toLocaleDateString()} entry. Reason: ${supervisorComment}`,
      type: entry.status === 'approved' ? 'success' : 'warning'
    });
    await notification.save();
    
    io.to(`user:${student.user}`).emit('notification', { 
      title: notification.title, 
      message: notification.message 
    });

    res.json({ message: 'Logbook entry reviewed', entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateLogbookEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { activities, toolsUsed, skillsLearned, challenges, solutions } = req.body;

    const entry = await Logbook.findById(id);
    if (!entry) {
      res.status(404).json({ error: 'Entry not found' });
      return;
    }

    // Security check: Only owner can edit, and only if not approved
    const student = await Student.findOne({ user: req.user!.id });
    if (!student || entry.student.toString() !== student._id.toString()) {
      res.status(403).json({ error: 'Permission denied' });
      return;
    }

    if (entry.status === 'approved') {
      res.status(400).json({ error: 'Approved entries cannot be edited' });
      return;
    }

    // Update fields
    entry.activities = activities || entry.activities;
    entry.toolsUsed = toolsUsed || entry.toolsUsed;
    entry.skillsLearned = skillsLearned || entry.skillsLearned;
    entry.challenges = challenges || entry.challenges;
    entry.solutions = solutions || entry.solutions;
    
    // Reset status to submitted for re-review
    entry.status = 'submitted';
    
    await entry.save();
    res.json({ message: 'Logbook entry updated successfully', entry });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getSupervisorStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const students = await Student.find({ supervisor: req.user!.id, isDeleted: false })
      .populate('user', 'firstName lastName email profilePicture')
      .populate('programme', 'name code');

    const result = await Promise.all(students.map(async (s) => {
      const stats = await Logbook.aggregate([
        { $match: { student: s._id } },
        { $group: {
            _id: null,
            total: { $sum: 1 },
            approved: { $sum: { $cond: [{ $eq: ["$status", "approved"] }, 1, 0] } },
            pending: { $sum: { $cond: [{ $eq: ["$status", "submitted"] }, 1, 0] } },
            avgRating: { $avg: "$supervisorRating" }
        }}
      ]);

      const logStats = stats[0] || { total: 0, approved: 0, pending: 0, avgRating: 0 };
      return {
        ...s.toObject(),
        logStats
      };
    }));

    res.json({ students: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getWeeklyPerformance(req: AuthRequest, res: Response): Promise<void> {
  try {
    // For Internship Coordinators: Aggregate stats across their programme or all
    let query: any = { isDeleted: false };
    if (req.user!.role !== 'admin') {
      const dbUser = await User.findById(req.user!.id).populate('programme');
      if (dbUser && dbUser.programme) query.programme = (dbUser.programme as any)._id;
    }

    const students = await Student.find(query).populate('user', 'firstName lastName');
    
    const performance = await Promise.all(students.map(async (s) => {
      const latestEntries = await Logbook.find({ student: s._id })
        .sort({ entryDate: -1 })
        .limit(7);
      
      const avgRating = latestEntries.reduce((acc, curr) => acc + (curr.supervisorRating || 0), 0) / (latestEntries.filter(e => e.supervisorRating).length || 1);
      
      return {
        studentName: `${(s.user as any).firstName} ${(s.user as any).lastName}`,
        matric: s.matricNumber,
        entriesThisWeek: latestEntries.length,
        avgRating: Number(avgRating.toFixed(1)),
        status: s.status
      };
    }));

    res.json({ performance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function syncOfflineEntries(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { entries } = req.body as { entries: any[] };
    const student = await Student.findOne({ user: req.user!.id });
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    let synced = 0, skipped = 0;
    for (const e of entries) {
      const existing = await Logbook.findOne({ student: student._id, entryDate: e.entryDate });
      if (!existing) {
        const newEntry = new Logbook({
          ...e,
          student: student._id,
          tenant: student.tenant,
          status: 'submitted',
          isOfflineSync: true
        });
        await newEntry.save();
        synced++;
      } else {
        skipped++;
      }
    }

    res.json({ message: `Synced ${synced} entries, skipped ${skipped} duplicates`, synced, skipped });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function deleteLogbookEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const entry = await Logbook.findOneAndDelete({ _id: req.params.id, status: 'draft' });
    if (!entry) {
      res.status(400).json({ error: 'Entry not found or cannot be deleted' });
      return;
    }
    res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
