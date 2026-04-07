import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Attendance from '../models/Attendance.model';
import Student from '../models/Student.model';
import Setting from '../models/Setting.model';
import { calculateDistance } from '../utils/geo.utils';

export async function checkIn(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { lat, lng, method = 'gps' } = req.body;
    const student = await Student.findOne({ user: req.user!.id }).populate('company');

    if (!student) {
      res.status(404).json({ error: 'Student profile not found' });
      return;
    }

    // Check already checked in today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existing = await Attendance.findOne({
      student: student._id,
      checkInTime: { $gte: startOfDay, $lte: endOfDay }
    });

    if (existing) {
      res.status(409).json({ error: 'Already checked in today' });
      return;
    }

    let distance: number | null = null;
    let isValid = true;
    
    const radiusSetting = await Setting.findOne({ key: 'attendance_radius_km' });
    const radiusKm = parseFloat(radiusSetting?.value || '0.5');

    const company = student.company as any;
    if (company && company.lat && company.lng && lat && lng) {
      distance = calculateDistance(lat, lng, company.lat, company.lng);
      isValid = distance <= radiusKm;
    }

    const attendance = new Attendance({
      student: student._id,
      checkInTime: new Date(),
      lat,
      lng,
      distanceFromCompany: distance,
      isValid,
      method
    });

    await attendance.save();

    // Update student location
    if (lat && lng) {
      student.lat = lat;
      student.lng = lng;
      student.lastSeen = new Date();
      await student.save();
    }

    res.json({
      message: isValid ? '✅ Check-in successful' : '⚠️ Check-in recorded but location is outside company radius',
      isValid,
      distance: distance ? `${distance.toFixed(2)} km` : null,
      attendanceId: attendance._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function checkOut(req: AuthRequest, res: Response): Promise<void> {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const student = await Student.findOne({ user: req.user!.id });
    if (!student) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const record = await Attendance.findOne({
      student: student._id,
      checkInTime: { $gte: startOfDay, $lte: endOfDay },
      checkOutTime: { $exists: false }
    });

    if (!record) {
      res.status(404).json({ error: 'No active check-in found for today' });
      return;
    }

    record.checkOutTime = new Date();
    await record.save();

    res.json({ message: '✅ Check-out successful' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAttendanceRecords(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId, month, year } = req.query;
    let targetId = studentId;

    if (req.user!.role === 'student') {
      const student = await Student.findOne({ user: req.user!.id });
      targetId = student?._id.toString();
    }

    let filter: any = {};
    if (targetId) filter.student = targetId;

    if (month && year) {
      const startOfMonth = new Date(Number(year), Number(month) - 1, 1);
      const endOfMonth = new Date(Number(year), Number(month), 0, 23, 59, 59);
      filter.checkInTime = { $gte: startOfMonth, $lte: endOfMonth };
    }

    const records = await Attendance.find(filter)
      .populate({
        path: 'student',
        populate: { path: 'user', select: 'firstName lastName email' }
      })
      .sort({ checkInTime: -1 });

    let summary = null;
    if (targetId) {
      summary = {
        total: await Attendance.countDocuments({ student: targetId as string }),
        valid: await Attendance.countDocuments({ student: targetId as string, isValid: true })
      };
    }

    res.json({ records, summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getAttendanceAnalytics(req: AuthRequest, res: Response): Promise<void> {
  try {
    // Basic aggregation can be performed here for production level analytics
    const records = await Attendance.find().limit(100); 
    res.json({ records, message: 'Rich analytics coming soon' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function manualAttendance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { studentId, date, notes } = req.body;
    const attendance = new Attendance({
      student: studentId,
      checkInTime: new Date(`${date} 08:00:00`),
      isValid: true,
      method: 'manual',
      notes
    });
    await attendance.save();
    res.status(201).json({ message: 'Manual attendance recorded', id: attendance._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
