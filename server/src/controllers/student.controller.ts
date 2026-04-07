import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Student from '../models/Student.model';
import User from '../models/User.model';
import Programme from '../models/Programme.model';
import Logbook from '../models/Logbook.model';
import NotificationModel from '../models/Notification.model';
import { autoAllocateStudent } from '../utils/allocation.service';

export async function getAllStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { programme, status, company, session, search } = req.query;
    
    const { role: userRole, programme: userProg } = req.user!;
    let query: any = {};

    if (programme) query.programme = programme;
    if (status) query.status = status;
    if (company) query.company = company;
    if (session) query.academicSession = session;

    // Programme Isolation
    if (userRole !== 'admin') {
      query.programme = userProg;
    }

    const students = await Student.find(query)
      .populate('user', '-password')
      .populate('programme')
      .populate('company')
      .populate('supervisor', 'firstName lastName');

    // Simple manual filtering for search since it spans multiple collections
    let filteredStudents = students;
    if (search) {
      const searchLower = (search as string).toLowerCase();
      filteredStudents = students.filter(s => {
        const u = s.user as any;
        return (
          u.firstName.toLowerCase().includes(searchLower) ||
          u.lastName.toLowerCase().includes(searchLower) ||
          s.matricNumber.toLowerCase().includes(searchLower) ||
          u.email.toLowerCase().includes(searchLower)
        );
      });
    }

    res.json({ students: filteredStudents, total: filteredStudents.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getStudentById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const student = await Student.findById(req.params.id)
      .populate('user', '-password')
      .populate('programme')
      .populate('company')
      .populate('supervisor', 'firstName lastName email phone');

    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    // Attendance and Logbook summaries can be added here once those models are fully integrated
    const logbookSummary = {
      totalEntries: await Logbook.countDocuments({ student: student._id }),
      approved: await Logbook.countDocuments({ student: student._id, status: 'approved' }),
      pending: await Logbook.countDocuments({ student: student._id, status: { $in: ['submitted', 'draft'] } })
    };

    res.json({ student, logbookSummary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const updateData = req.body;
    const student = await Student.findByIdAndUpdate(
      req.params.id, 
      { $set: updateData }, 
      { new: true }
    );
    
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    res.json({ message: 'Student updated successfully', student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function requestAllocation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await autoAllocateStudent(req.params.id);
    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }
    res.json({ message: 'Student allocated successfully', allocation: result });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Allocation failed' });
  }
}

export async function getStudentDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    const student = await Student.findOne({ user: req.user!.id })
      .populate('user', '-password')
      .populate('programme')
      .populate('company')
      .populate('supervisor', 'firstName lastName email');

    if (!student) {
      res.status(404).json({ error: 'Student profile not found' });
      return;
    }

    const stats = {
      totalLogbooks: await Logbook.countDocuments({ student: student._id }),
      approvedLogbooks: await Logbook.countDocuments({ student: student._id, status: 'approved' }),
      // Attendance days logic here
      attendanceDays: 0 
    };

    const notifications = await NotificationModel.find({ user: req.user!.id, isRead: false })
      .sort({ createdAt: -1 })
      .limit(5);

    const recentLogbook = await Logbook.find({ student: student._id })
      .sort({ entryDate: -1 })
      .limit(5);

    res.json({
      student,
      stats,
      notifications,
      recentLogbook,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function deleteStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const student = await Student.findById(req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    await User.findByIdAndDelete(student.user);
    await Student.findByIdAndDelete(req.params.id);
    res.json({ message: 'Student deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getProgrammes(_req: Request, res: Response): Promise<void> {
  try {
    const programmes = await Programme.find({ isActive: true }).sort({ level: 1, name: 1 });
    res.json({ programmes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateStudentLocation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lat, lng } = req.body;
    let student = await Student.findOneAndUpdate(
      { user: req.user!.id },
      { $set: { lat, lng, lastSeen: new Date() } },
      { new: true }
    );
    if (!student) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    // Auto-allocate if not yet assigned
    if (!student.company) {
      try {
        await autoAllocateStudent((student._id as any).toString());
        // Re-fetch student to get the updated company info
        student = await Student.findById(student._id).populate('company') as any;
      } catch (allocErr) {
        console.error('Auto-allocation failed during location update:', allocErr);
      }
    }

    res.json({ message: 'Location updated', student });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAllStudentsForMap(req: AuthRequest, res: Response): Promise<void> {
  try {
    const students = await Student.find({ status: { $in: ['active', 'pending'] } })
      .populate('user', 'firstName lastName')
      .populate('programme', 'name level')
      .populate('company', 'name lat lng');
    
    res.json({ students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/students/export - Institutional data export (CSV) */
export async function exportStudents(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role: userRole, programme: userProg } = req.user!;
    let query: any = {};
    if (userRole !== 'admin') {
      query.programme = userProg;
    }

    const students = await Student.find(query)
      .populate('user', 'firstName lastName email phone')
      .populate('programme', 'name code level')
      .populate('company', 'name')
      .populate('supervisor', 'firstName lastName')
      .sort({ createdAt: -1 });

    let csv = 'Matric,First Name,Last Name,Email,Phone,Programme,Level,Company,Supervisor,Progress,Status\n';
    
    for (const s of students) {
      const u = s.user as any;
      const prog = s.programme as any;
      const comp = s.company as any;
      const sup = s.supervisor as any;
      
      const logCount = await Logbook.countDocuments({ student: s._id, status: 'approved' });
      const progress = `${logCount} logs approved`;

      csv += `${s.matricNumber},${u.firstName},${u.lastName},${u.email},${u.phone || ''},${prog.name},${prog.level},${comp?.name || 'Unassigned'},${sup ? `${sup.firstName} ${sup.lastName}` : 'N/A'},${progress},${s.status}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=ACETEL_Students_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Data export failed' });
  }
}

