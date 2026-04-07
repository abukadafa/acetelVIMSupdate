import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.model';
import Student from '../models/Student.model';
import Programme from '../models/Programme.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { fetchStudentDetails } from '../utils/sdms.service';
import AuditLog from '../models/AuditLog.model';

function generateTokens(user: { id: string; role: string; email: string; programme?: string }) {
  const access = jwt.sign(
    { id: user.id, role: user.role, email: user.email, programme: user.programme }, 
    process.env.JWT_SECRET || 'secret', 
    { expiresIn: '8h' }
  );
  const refresh = jwt.sign(
    { id: user.id }, 
    process.env.JWT_REFRESH_SECRET || 'refresh', 
    { expiresIn: '7d' }
  );
  return { access, refresh };
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const { identifier, password } = req.body;
    
    const user = await User.findOne({ 
      $or: [
        { email: identifier?.toLowerCase() }, 
        { username: identifier?.toLowerCase() }
      ], 
      isActive: true 
    });
    if (!user) {
      await AuditLog.create({
        user: undefined, // Unknown user
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        details: `Failed login attempt for identifier: ${identifier}`,
        ipAddress: req.ip
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await AuditLog.create({
        user: user._id,
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        details: `Incorrect password attempt for user: ${user.email}`,
        ipAddress: req.ip
      });
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    user.lastLogin = new Date();
    await user.save();

    await AuditLog.create({
      user: user._id,
      action: 'LOGIN_SUCCESS',
      module: 'AUTH',
      details: `Successful login for user: ${user.email} (${user.role})`,
      ipAddress: req.ip
    });

    const { access, refresh } = generateTokens({ 
      id: user._id.toString(), 
      role: user.role, 
      email: user.email,
      programme: user.programme?.toString()
    });

    let studentData = null;
    if (user.role === 'student') {
      studentData = await Student.findOne({ user: user._id })
        .populate('programme')
        .populate('company')
        .populate('supervisor', 'firstName lastName email phone');
    }

    res.json({
      token: access,
      refreshToken: refresh,
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatar: user.avatar,
      },
      student: studentData,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const { 
      email, password, firstName, lastName, phone, 
      role = 'student', matricNumber, academicSession, level,
      stateOfOrigin, lga, address, lat, lng
    } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    // Role-specific validation and auto-fetch
    let programmeId = null;
    if (role === 'student') {
      if (!matricNumber) {
        res.status(400).json({ error: 'Matric number is required for students' });
        return;
      }

      // INTELLIGENT GAP FILL: Auto-Fetch student details from SDMS
      const sdmsData = await fetchStudentDetails(matricNumber);
      if (!sdmsData) {
        res.status(404).json({ error: 'Matric number not found in ACETEL records' });
        return;
      }

      // Match programme
      const prog = await Programme.findOne({ code: sdmsData.programme });
      if (!prog) {
        res.status(400).json({ error: 'Academic programme not recognized' });
        return;
      }
      programmeId = prog._id;
    }

    // Hande Avatar upload
    const avatarPath = req.file ? `/uploads/avatars/${req.file.filename}` : undefined;

    // Get default tenant (ACETEL)
    const Tenant = (await import('../models/Tenant.model')).default;
    let tenant = await Tenant.findOne({ slug: 'acetel' });
    if (!tenant) {
      tenant = new Tenant({ name: 'ACETEL', slug: 'acetel', institutionType: 'University' });
      await tenant.save();
    }

    const user = new User({
      email: email.toLowerCase(),
      username: (role === 'student' ? matricNumber : email).toLowerCase(),
      password,
      role,
      firstName,
      lastName,
      phone,
      avatar: avatarPath,
      tenant: tenant._id
    });

    await user.save();

    if (role === 'student') {
      const student = new Student({
        user: user._id,
        tenant: tenant._id,
        matricNumber,
        programme: programmeId,
        academicSession: academicSession || '2024/2025',
        level: level || 'MSc',
        stateOfOrigin,
        lga,
        address,
        lat,
        lng,
        riskScore: 0,
        riskLevel: 'Low'
      });
      await student.save();
    }

    await AuditLog.create({
      user: user._id,
      action: 'USER_REGISTERED',
      module: 'AUTH',
      details: `New account registered: ${email} as ${user.role}${role === 'student' ? ' (Student)' : ''}`,
      ipAddress: req.ip
    });

    const { access, refresh } = generateTokens({ 
      id: user._id.toString(), 
      role: user.role, 
      email: user.email 
    });

    res.status(201).json({ 
      token: access, 
      refreshToken: refresh, 
      message: 'Registration successful' 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: token } = req.body;
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'refresh') as { id: string };
    const user = await User.findById(decoded.id);
    if (!user || !user.isActive) {
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }
    const { access, refresh } = generateTokens({ 
      id: user._id.toString(), 
      role: user.role, 
      email: user.email,
      programme: user.programme?.toString()
    });
    res.json({ token: access, refreshToken: refresh });
  } catch {
    res.status(401).json({ error: 'Invalid refresh token' });
  }
}

export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await User.findById(req.user!.id).select('-password');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    let studentData = null;
    if (user.role === 'student') {
      studentData = await Student.findOne({ user: user._id })
        .populate('programme')
        .populate('company')
        .populate('supervisor', 'firstName lastName email phone');
    }

    res.json({ user, student: studentData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      res.status(400).json({ error: 'Current password incorrect' });
      return;
    }

    user.password = newPassword; // Pre-save hook will hash it
    await user.save();

    await AuditLog.create({
      user: user._id,
      action: 'PASSWORD_CHANGED',
      module: 'SECURITY',
      details: `User ${user.email} changed their password`,
      ipAddress: req.ip
    });

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function logout(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.user) {
      const user = await User.findById(req.user.id);
      await AuditLog.create({
        user: req.user.id as any,
        action: 'LOGOUT',
        module: 'AUTH',
        details: `User ${user?.email || req.user.id} logged out`,
        ipAddress: req.ip
      });
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
