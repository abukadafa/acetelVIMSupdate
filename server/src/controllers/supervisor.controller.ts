import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import User from '../models/User.model';
import Student from '../models/Student.model';
import Logbook from '../models/Logbook.model';
import Assessment from '../models/Assessment.model';
import Notification from '../models/notification.model';
import { io } from '../index';
import bcrypt from 'bcryptjs';

export async function getSupervisorStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const supervisorId = req.user!.role === 'supervisor' ? req.user!.id : (req.query.supervisorId as string);
    
    const students = await Student.find({ supervisor: supervisorId })
      .populate('user', '-password')
      .populate('programme')
      .populate('company');

    // Add aggregate stats for each student
    const studentsWithStats = await Promise.all(
      students.map(async (s) => {
        const logbookCount = await Logbook.countDocuments({ student: s._id });
        const pendingReviews = await Logbook.countDocuments({ student: s._id, status: 'submitted' });
        // Attendance logic here later
        return { 
          ...s.toObject(), 
          logbookCount, 
          pendingReviews,
          attendanceDays: 0 
        };
      })
    );

    res.json({ students: studentsWithStats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getPendingReviews(req: AuthRequest, res: Response): Promise<void> {
  try {
    const supervisorId = req.user!.id;
    const students = await Student.find({ supervisor: supervisorId }).select('_id');
    const studentIds = students.map(s => s._id);

    const entries = await Logbook.find({ 
      student: { $in: studentIds },
      status: 'submitted'
    })
    .populate({
      path: 'student',
      populate: [
        { path: 'user', select: 'firstName lastName' },
        { path: 'programme', select: 'name' },
        { path: 'company', select: 'name' }
      ]
    })
    .sort({ entryDate: 1 });

    res.json({ entries, count: entries.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function submitAssessment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId, type, period, punctuality, attitude, technicalSkills, communication, initiative, comments } = req.body;
    
    const assessment = new Assessment({
      student: studentId,
      supervisor: req.user!.id,
      type,
      period,
      punctuality,
      attitude,
      technicalSkills,
      communication,
      initiative,
      comments
    });

    await assessment.save();

    // The Assessment model has a pre-save hook that calculates overallScore
    const student = await Student.findById(studentId);
    if (student) {
      student.overallScore = assessment.overallScore;
      await student.save();

      // Notify student
      const notification = new Notification({
        user: student.user,
        title: 'Assessment Completed',
        message: `Your ${type.replace('_',' ')} assessment has been submitted. Score: ${assessment.overallScore?.toFixed(1)}/20`,
        type: 'success'
      });
      await notification.save();
      io.to(`user:${student.user}`).emit('notification', { 
        title: notification.title, 
        score: assessment.overallScore 
      });
    }

    res.status(201).json({ message: 'Assessment submitted', assessment });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAllSupervisors(req: AuthRequest, res: Response): Promise<void> {
  try {
    const supervisors = await User.find({ role: 'supervisor' }).select('-password').sort({ lastName: 1 });
    
    const supervisorsWithCount = await Promise.all(
      supervisors.map(async (u) => {
        const assignedCount = await Student.countDocuments({ supervisor: u._id });
        return { ...u.toObject(), assignedStudents: assignedCount };
      })
    );

    res.json({ supervisors: supervisorsWithCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function createSupervisor(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email, firstName, lastName, phone } = req.body;
    
    const existing = await User.findOne({ email });
    if (existing) {
      res.status(409).json({ error: 'Email exists' });
      return;
    }

    const password = await bcrypt.hash('Acetel@2024', 12);
    const supervisor = new User({
      email,
      password,
      role: 'supervisor',
      firstName,
      lastName,
      phone
    });

    await supervisor.save();
    res.status(201).json({ message: 'Supervisor created. Default password: Acetel@2024', id: supervisor._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { recipientId, programmeId, subject, body, isBulk } = req.body;
    
    // In a full implementation, we'd have a Message model. 
    // Here we'll just use notifications as the messaging medium for now.
    
    if (isBulk && programmeId) {
      const students = await Student.find({ programme: programmeId });
      
      for (const s of students) {
        const notification = new Notification({
          user: s.user,
          title: subject,
          message: body,
          type: 'info'
        });
        await notification.save();
        io.to(`user:${s.user}`).emit('notification', { title: subject });
      }
    } else if (recipientId) {
      const notification = new Notification({
        user: recipientId,
        title: subject,
        message: body,
        type: 'info'
      });
      await notification.save();
      io.to(`user:${recipientId}`).emit('notification', { title: subject });
    }

    res.status(201).json({ message: 'Message sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
