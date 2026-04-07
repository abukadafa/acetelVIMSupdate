import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Feedback from '../models/Feedback.model';
import User from '../models/User.model';
import Student from '../models/Student.model';

/** POST /api/feedback - Create new feedback entry */
export async function createFeedback(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { subject, category, message } = req.body;
    
    // Find student's programme to auto-assign for coordination
    let programmeId = undefined;
    if (req.user?.role === 'student') {
      const student = await Student.findOne({ user: req.user.id });
      programmeId = student?.programme;
    }

    const feedback = new Feedback({
      user: req.user!.id,
      subject,
      category,
      message,
      programme: programmeId,
      status: 'Open'
    });

    await feedback.save();
    res.status(201).json({ feedback, message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/feedback - List feedback based on role and scope */
export async function listFeedback(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { status, category } = req.query;
    const filter: Record<string, any> = {};
    
    if (status) filter.status = status;
    if (category) filter.category = category;

    // RBAC Scoping
    if (req.user?.role === 'student') {
      filter.user = req.user.id;
    } else if (req.user?.role === 'prog_coordinator') {
      // Find the coordinator's programme
      const coord = await User.findById(req.user.id);
      if (coord?.programme) {
        filter.programme = coord.programme;
      }
    } else if (req.user?.role === 'supervisor') {
      // Supervisors see feedback from their assigned students
      const students = await Student.find({ supervisor: req.user.id }).select('user');
      const studentUserIds = students.map(s => s.user);
      filter.user = { $in: studentUserIds };
    }
    // admin and coordinator see all

    const feedback = await Feedback.find(filter)
      .populate('user', 'firstName lastName role email avatar')
      .populate('responses.user', 'firstName lastName role')
      .sort({ updatedAt: -1 });

    res.json({ feedback });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/feedback/:id/respond - Add response to feedback */
export async function addResponse(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { message } = req.body;

    const feedback = await Feedback.findById(id);
    if (!feedback) {
      res.status(404).json({ error: 'Feedback entry not found' });
      return;
    }

    // Update status if staff is responding
    if (['admin', 'prog_coordinator', 'internship_coordinator', 'supervisor'].includes(req.user!.role)) {
       feedback.status = 'Assigned';
       feedback.assignedTo = req.user!.id as any;
    }

    feedback.responses.push({
      user: req.user!.id as any,
      message,
      createdAt: new Date()
    });

    await feedback.save();

    const updated = await Feedback.findById(id)
      .populate('user', 'firstName lastName role email')
      .populate('responses.user', 'firstName lastName role');

    res.json({ feedback: updated, message: 'Response added' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** PUT /api/feedback/:id/status - Change status (e.g. close) */
export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['Open', 'Assigned', 'Closed'].includes(status)) {
      res.status(400).json({ error: 'Invalid status' });
      return;
    }

    const feedback = await Feedback.findByIdAndUpdate(id, { status }, { new: true });
    res.json({ feedback, message: `Status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/feedback/export - Institutional feedback export (CSV) */
export async function exportFeedback(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role: userRole, programme: userProg } = req.user!;
    const filter: any = {};
    
    if (userRole === 'student') {
      filter.user = req.user!.id;
    } else if (userRole === 'prog_coordinator') {
      filter.programme = userProg;
    }

    const feedbacks = await Feedback.find(filter)
      .populate('user', 'firstName lastName email role')
      .populate('responses.user', 'firstName lastName role')
      .sort({ createdAt: -1 });

    let csv = 'Ref,Date,Subject,Category,Author,Author Role,Latest Response,Status\n';
    
    for (const f of feedbacks) {
      const u = f.user as any;
      const lastResp = f.responses.length > 0 ? f.responses[f.responses.length-1] : null;
      const lastRespTxt = lastResp ? `"${lastResp.message.replace(/"/g, '""')}"` : 'None';
      
      csv += `${f._id.toString().slice(-6)},${f.createdAt.toISOString().split('T')[0]},"${f.subject.replace(/"/g, '""')}",${f.category},${u.firstName} ${u.lastName},${u.role},${lastRespTxt},${f.status}\n`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=ACETEL_Feedback_${new Date().toISOString().split('T')[0]}.csv`);
    res.status(200).send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Feedback export failed' });
  }
}

