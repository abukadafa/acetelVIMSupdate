import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Setting from '../models/Setting.model';
import AuditLog from '../models/AuditLog.model';
import Student from '../models/Student.model';
import User from '../models/User.model';
import Company from '../models/Company.model';
import Logbook from '../models/Logbook.model';
import Attendance from '../models/Attendance.model';

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    const settings = await Setting.find({});
    const obj: Record<string, string> = {};
    settings.forEach(s => { obj[s.key] = s.value; });
    res.json({ settings: obj });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateSetting(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { key, value } = req.body;
    await Setting.findOneAndUpdate(
      { key },
      { $set: { value, updatedAt: new Date() } },
      { upsert: true, new: true }
    );
    
    // Log the action
    await new AuditLog({
      user: req.user!.id,
      action: 'UPDATE_SETTING',
      module: 'SETTINGS',
      details: `Updated ${key} to ${value}`
    }).save();

    res.json({ message: 'Setting updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateMultipleSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { settings } = req.body as { settings: Record<string, string> };
    
    for (const [key, value] of Object.entries(settings)) {
      await Setting.findOneAndUpdate(
        { key },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true }
      );
    }

    await new AuditLog({
      user: req.user!.id,
      action: 'UPDATE_MULTIPLE_SETTINGS',
      module: 'SETTINGS',
      details: `Updated ${Object.keys(settings).length} settings`
    }).save();

    res.json({ message: 'Settings updated' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAuditLog(_req: Request, res: Response): Promise<void> {
  try {
    const logs = await AuditLog.find({})
      .populate('user', 'firstName lastName role')
      .sort({ createdAt: -1 })
      .limit(100);
    res.json({ logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAdminDashboard(_req: Request, res: Response): Promise<void> {
  try {
    const totalStudents = await Student.countDocuments();
    const activeStudents = await Student.countDocuments({ status: 'active' });
    const pendingStudents = await Student.countDocuments({ status: 'pending' });
    const totalCompanies = await Company.countDocuments({ isApproved: true });
    const totalSupervisors = await User.countDocuments({ role: 'supervisor' });
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    
    const todayAttendance = await Attendance.countDocuments({
      checkInTime: { $gte: today, $lt: tomorrow }
    });

    const pendingLogbooks = await Logbook.countDocuments({ status: 'submitted' });
    const unallocated = await Student.countDocuments({ company: { $exists: false } });

    const recentStudents = await Student.find({})
      .populate('user', 'firstName lastName email')
      .populate('programme', 'name level')
      .sort({ createdAt: -1 })
      .limit(8);

    const recentActivity = await AuditLog.find({})
      .populate('user', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      stats: { 
        totalStudents, 
        activeStudents, 
        pendingStudents, 
        totalCompanies, 
        totalSupervisors, 
        todayAttendance, 
        pendingLogbooks, 
        unallocated 
      },
      recentStudents,
      recentActivity,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
