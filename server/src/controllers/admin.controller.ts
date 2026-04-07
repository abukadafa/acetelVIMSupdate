import { Response } from 'express';
import User from '../models/User.model';
import Programme from '../models/Programme.model';
import Tenant from '../models/Tenant.model';
import { AuthRequest } from '../middleware/auth.middleware';
import bcrypt from 'bcryptjs';
import AuditLog from '../models/AuditLog.model';
import Student from '../models/Student.model';
import Company from '../models/Company.model';

const STAFF_ROLES = ['admin', 'prog_coordinator', 'internship_coordinator', 'ict_support', 'supervisor'];

/** GET /api/admin/users  — all staff users */
export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { role, programme, search, page = 1, limit = 50 } = req.query as Record<string, string>;

    const filter: Record<string, any> = { 
      role: { $in: STAFF_ROLES },
      isDeleted: { $ne: true } 
    };
    
    // Programme Isolation
    if (req.user!.role !== 'admin') {
      filter.programme = req.user!.programme;
    } else if (programme) {
      filter.programme = programme;
    }

    if (role) filter.role = role;
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')
        .populate('programme', 'code name level')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    // Role-wise counts
    const counts = await User.aggregate([
      { $match: { role: { $in: STAFF_ROLES } } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]);

    res.json({ users, total, counts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/users  — create a new staff user */
export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { firstName, lastName, email, role, programme, phone, password } = req.body;

    // Single Admin Policy: Do not allow creating new admins
    if (role === 'admin') {
      res.status(403).json({ error: 'Only one administrator is allowed in the system. Permission denied.' });
      return;
    }

    if (!['prog_coordinator', 'internship_coordinator', 'ict_support', 'supervisor', 'admin'].includes(role)) {
      res.status(400).json({ error: 'Invalid staff role' });
      return;
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }

    // Programme Isolation for Creation
    if (req.user!.role !== 'admin') {
      req.body.programme = req.user!.programme;
    }

    // Programme required for role that is programme-scoped
    const programmeScoped = ['prog_coordinator', 'ict_support'];
    if (programmeScoped.includes(role) && !req.body.programme) {
      res.status(400).json({ error: `A programme must be selected for role: ${role}` });
      return;
    }

    // Ensure programme exists if provided
    if (programme) {
      const prog = await Programme.findById(programme);
      if (!prog) {
        res.status(400).json({ error: 'Programme not found' });
        return;
      }
    }

    // Get default tenant
    let tenant = await Tenant.findOne({ slug: 'acetel' });
    if (!tenant) {
      tenant = new Tenant({ name: 'ACETEL', slug: 'acetel', institutionType: 'University' });
      await tenant.save();
    }

    const tempPassword = password || `Acetel@${Math.floor(1000 + Math.random() * 9000)}`;

    const user = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      username: email.toLowerCase(),
      password: tempPassword,
      role,
      phone,
      programme: programme || undefined,
      tenant: tenant._id,
      isActive: true,
    });

    await user.save();

    const saved = await User.findById(user._id)
      .select('-password')
      .populate('programme', 'code name level');

    res.status(201).json({
      user: saved,
      tempPassword, // sent back once so admin can share it
      message: 'User created successfully',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function createStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { 
      firstName, lastName, email, matricNumber, 
      programme, phone, password, 
      personalEmail, gender, isNigerian, address,
      academicSession, level 
    } = req.body;

    // Programme Isolation
    const targetProgramme = req.user!.role !== 'admin' ? req.user!.programme : programme;

    if (!targetProgramme) {
      res.status(400).json({ error: 'A programme must be selected' });
      return;
    }

    const existing = await User.findOne({ 
      $or: [
        { email: email.toLowerCase() },
        { username: matricNumber.toLowerCase() }
      ] 
    });
    if (existing) {
      res.status(409).json({ error: 'Identity (Email or Matric Number) already in use' });
      return;
    }

    const existingMatric = await Student.findOne({ matricNumber });
    if (existingMatric) {
      res.status(409).json({ error: 'Matric number already registered' });
      return;
    }

    // Get default tenant
    let TenantModel = (await import('../models/Tenant.model')).default;
    let tenant = await TenantModel.findOne({ slug: 'acetel' });
    if (!tenant) {
      tenant = new TenantModel({ name: 'ACETEL', slug: 'acetel', institutionType: 'University' });
      await tenant.save();
    }

    const tempPassword = password || `Student@${Math.floor(1000 + Math.random() * 9000)}`;

    const user = new User({
      firstName,
      lastName,
      email: email.toLowerCase(),
      username: matricNumber.toLowerCase(),
      password: tempPassword,
      role: 'student',
      phone,
      tenant: tenant._id,
      isActive: true,
    });

    await user.save();

    const student = new Student({
      user: user._id,
      tenant: tenant._id,
      matricNumber,
      programme: targetProgramme,
      academicSession: academicSession || '2024/2025',
      level: level || 'MSc',
      status: 'pending',
      personalEmail,
      gender,
      isNigerian: isNigerian ?? true,
      address
    });

    await student.save();

    await AuditLog.create({
      user: req.user!.id,
      action: 'CREATE_STUDENT',
      module: 'STUDENT_MANAGEMENT',
      targetId: student._id,
      details: `Onboarded student ${email} for programme ${targetProgramme}`,
      ipAddress: req.ip
    });

    res.status(201).json({
      message: 'Student onboarded successfully',
      tempPassword
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** PUT /api/admin/users/:id */
export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { firstName, lastName, phone, role, programme, isActive, resetPassword, reason } = req.body;

    if (!reason) {
      res.status(400).json({ error: 'A reason must be provided for editing a user' });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Single Admin Policy: Do not allow promoting other users to admin
    if (role === 'admin' && user.role !== 'admin') {
      res.status(403).json({ error: 'The Administrator role is unique and cannot be assigned to other users.' });
      return;
    }

    // Role Allocation Restriction: Only admin can change roles
    if (role && role !== user.role && req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Only administrators can allocate or change user roles' });
      return;
    }

    if (firstName)  user.firstName = firstName;
    if (lastName)   user.lastName  = lastName;
    if (phone)      user.phone     = phone;
    if (role)       user.role      = role;
    if (programme !== undefined) user.programme = programme || undefined;
    if (isActive   !== undefined) user.isActive = isActive;

    let newPassword: string | undefined;
    if (resetPassword) {
      newPassword = `Acetel@${Math.floor(1000 + Math.random() * 9000)}`;
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    await user.save();

    // Log update
    await AuditLog.create({
      user: req.user!.id,
      action: 'UPDATE_USER',
      module: 'USER_MANAGEMENT',
      targetId: id,
      reason,
      details: `Updated staff profile for ${user.email}${resetPassword ? ' (Password Reset)' : ''}`,
      ipAddress: req.ip
    });

    const updated = await User.findById(id)
      .select('-password')
      .populate('programme', 'code name level');

    res.json({ user: updated, newPassword, message: 'User profile updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** DELETE /api/admin/users/:id  — soft delete */
export async function deactivateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (id === req.user!.id) {
      res.status(400).json({ error: 'You cannot delete your own account' });
      return;
    }

    if (!reason) {
      res.status(400).json({ error: 'A reason must be provided for deleting a user' });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    user.isDeleted = true;
    user.isActive = false;
    user.deletedAt = new Date();
    user.deletedBy = req.user!.id as any;
    user.deleteReason = reason;
    await user.save();

    // Log audit
    await AuditLog.create({
      user: req.user!.id,
      action: 'DELETE_USER',
      module: 'USER_MANAGEMENT',
      targetId: id,
      reason,
      details: `Soft-deleted user ${user.email}`,
      ipAddress: req.ip
    });

    res.json({ message: 'User moved to recycle bin', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}




/** GET /api/admin/recycle-bin */
export async function listRecycleBin(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userFilter: any = { isDeleted: true };
    const studentFilter: any = { isDeleted: true };
    
    if (req.user!.role !== 'admin') {
      userFilter.programme = req.user!.programme;
      studentFilter.programme = req.user!.programme;
    }

    const deletedUsers = await User.find(userFilter)
      .select('-password')
      .populate('programme', 'code name')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 });

    const deletedStudents = await Student.find(studentFilter)
      .populate('user', 'firstName lastName email')
      .populate('programme', 'code name')
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 });

    const deletedCompanies = await Company.find({ isDeleted: true })
      .populate('deletedBy', 'firstName lastName')
      .sort({ deletedAt: -1 });

    res.json({ users: deletedUsers, students: deletedStudents, companies: deletedCompanies });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** GET /api/admin/audit-logs */
export async function getAuditLogs(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { targetId, module, action, limit = 100 } = req.query as Record<string, string>;
    
    const filter: Record<string, any> = {};
    if (targetId) filter.targetId = targetId;
    if (module)   filter.module = module;
    if (action)   filter.action = action;

    // Programme Isolation: non-admins can only see logs for users in their programme
    if (req.user!.role !== 'admin' && req.user!.programme) {
      const programmeUsers = await User.find({ programme: req.user!.programme }).distinct('_id');
      const programmeStudents = await Student.find({ programme: req.user!.programme }).distinct('_id');
      filter.$or = [
        { user: { $in: programmeUsers } },
        { targetId: { $in: [...programmeUsers.map(String), ...programmeStudents.map(String)] } },
      ];
    }

    const logs = await AuditLog.find(filter)
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    res.json({ logs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}


/** GET /api/admin/programmes  — active programmes for dropdown */
export async function listProgrammes(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const programmes = await Programme.find({ isActive: true }).sort({ name: 1 });
    res.json({ programmes });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/users/permanent-delete/:id — hard delete (admin only) */
export async function permanentDeleteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const user = await User.findById(id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    await AuditLog.create({
      user: req.user!.id,
      action: 'PERMANENT_DELETE_USER',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Permanently deleted user ${user.email}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    await User.findByIdAndDelete(id);
    res.json({ message: 'User permanently deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/users/restore/:id — restore with approval memo */
export async function restoreUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason must be provided for restoring a user' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const user = await User.findById(id);
    if (!user) { res.status(404).json({ error: 'User not found' }); return; }

    user.isDeleted = false;
    user.isActive = true;
    user.lastEditReason = `Restore: ${reason}`;
    await user.save();

    await AuditLog.create({
      user: req.user!.id,
      action: 'RESTORE_USER',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Restored user ${user.email}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    res.json({ message: 'User restored successfully', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/students/restore/:id */
export async function restoreStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const student = await Student.findById(id);
    if (!student) { res.status(404).json({ error: 'Student not found' }); return; }

    student.isDeleted = false;
    await student.save();

    // Also reactivate the linked user account
    await User.findByIdAndUpdate(student.user, { isDeleted: false, isActive: true });

    await AuditLog.create({
      user: req.user!.id,
      action: 'RESTORE_STUDENT',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Restored student record ${student.matricNumber}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    res.json({ message: 'Student restored successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/students/permanent-delete/:id */
export async function permanentDeleteStudent(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const student = await Student.findById(id);
    if (!student) { res.status(404).json({ error: 'Student not found' }); return; }

    await AuditLog.create({
      user: req.user!.id,
      action: 'PERMANENT_DELETE_STUDENT',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Permanently deleted student ${student.matricNumber}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    await User.findByIdAndDelete(student.user);
    await Student.findByIdAndDelete(id);
    res.json({ message: 'Student permanently deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/companies/restore/:id */
export async function restoreCompany(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const company = await Company.findByIdAndUpdate(
      id,
      { isDeleted: false, $unset: { deletedAt: 1, deletedBy: 1, deleteReason: 1 } },
      { new: true }
    );
    if (!company) { res.status(404).json({ error: 'Company not found' }); return; }

    await AuditLog.create({
      user: req.user!.id,
      action: 'RESTORE_COMPANY',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Restored partner company ${company.name}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    res.json({ message: 'Company restored successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** POST /api/admin/companies/permanent-delete/:id */
export async function permanentDeleteCompany(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const approvalMemo = req.file?.filename;

    if (!reason) { res.status(400).json({ error: 'A reason is required' }); return; }
    if (!approvalMemo) { res.status(400).json({ error: 'An approval memo document must be uploaded' }); return; }

    const company = await Company.findById(id);
    if (!company) { res.status(404).json({ error: 'Company not found' }); return; }

    await AuditLog.create({
      user: req.user!.id,
      action: 'PERMANENT_DELETE_COMPANY',
      module: 'RECYCLE_BIN',
      targetId: id,
      reason,
      details: `Permanently deleted partner ${company.name}. Memo: ${approvalMemo}`,
      ipAddress: req.ip,
    });

    await Company.findByIdAndDelete(id);
    res.json({ message: 'Company permanently deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}


/** GET /api/admin/audit-logs/export */
export async function exportSecurityAudit(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { targetId, module, action } = req.query as Record<string, string>;
    
    const filter: Record<string, any> = {};
    if (targetId) filter.targetId = targetId;
    if (module)   filter.module = module;
    if (action)   filter.action = action;

    // Programme Isolation
    if (req.user!.role !== 'admin' && req.user!.programme) {
      const programmeUsers = await User.find({ programme: req.user!.programme }).distinct('_id');
      const programmeStudents = await Student.find({ programme: req.user!.programme }).distinct('_id');
      filter.$or = [
        { user: { $in: programmeUsers } },
        { targetId: { $in: [...programmeUsers.map(String), ...programmeStudents.map(String)] } },
      ];
    }

    const logs = await AuditLog.find(filter)
      .populate('user', 'firstName lastName email role')
      .sort({ createdAt: -1 });

    const headers = ['Timestamp', 'Actor', 'Email', 'Role', 'Action', 'Module', 'Target ID', 'Reason', 'Details', 'IP Address'];
    const rows = logs.map(l => {
      const u = (l.user as any) || {};
      return [
        `"${l.createdAt.toISOString()}"`,
        `"${u.firstName ? `${u.firstName} ${u.lastName}` : 'System'}"`,
        `"${u.email || 'N/A'}"`,
        `"${u.role || 'N/A'}"`,
        `"${l.action}"`,
        `"${l.module}"`,
        `"${l.targetId || 'N/A'}"`,
        `"${l.reason || 'N/A'}"`,
        `"${l.details?.replace(/"/g, '""') || ''}"`,
        `"${l.ipAddress || 'N/A'}"`
      ];
    });

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=acetel_security_audit_${new Date().getTime()}.csv`);
    res.status(200).send(csvContent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

/** 
 * POST /api/admin/bulk-onboard
 * Massive enrollment for staff or students
 */
export async function bulkOnboard(req: AuthRequest, res: Response): Promise<void> {
  const { type, data } = req.body; // type: 'staff' | 'student', data: Array<any>
  
  if (!Array.isArray(data)) {
    res.status(400).json({ error: 'Data must be an array of objects' });
    return;
  }

  const results = {
    success: [] as any[],
    failed: [] as any[],
    total: data.length
  };

  try {
    // Get default tenant
    let tenant = await Tenant.findOne({ slug: 'acetel' });
    if (!tenant) {
      tenant = new Tenant({ name: 'ACETEL', slug: 'acetel', institutionType: 'University' });
      await tenant.save();
    }

    // Cache programmes for faster mapping
    const allProgs = await Programme.find({}).select('code _id');
    const progMap = allProgs.reduce((acc, p) => {
      acc[p.code.toLowerCase()] = p._id;
      return acc;
    }, {} as Record<string, mongoose.Types.ObjectId>);

    // PARTNER COMPANY BRANCH
    if (type === 'company') {
      const Company = (await import('../models/Company.model')).default;
      for (const row of data) {
        const name = row['Company Name'] || row.companyName || row.name;
        const address = row['Company Address'] || row.address;
        const specialisation = row['Area of Specialisation'] || row.specialisation || row.sector;
        const state = row['State'] || row.state || 'Lagos';

        if (!name || !address) {
          results.failed.push({ row, reason: 'Missing required company fields (Name/Address)' });
          continue;
        }

        try {
          const company = new Company({
            name: name.trim(),
            address: address.trim(),
            specialisation: specialisation ? String(specialisation).trim() : 'General',
            state: state.trim(),
            isApproved: true,
            tenant: tenant._id,
          });
          await company.save();
          results.success.push({ name: company.name, id: company._id });
        } catch (saveErr: any) {
          results.failed.push({ name, reason: saveErr.message });
        }
      }

      if (results.success.length > 0) {
        await AuditLog.create({
          user: req.user!.id,
          action: 'BULK_ONBOARD',
          module: 'PARTNER_MANAGEMENT',
          reason: `Bulk onboarded ${results.success.length} partner organizations`,
          details: `Successfully enrolled ${results.success.length} companies.`,
          ipAddress: req.ip,
        });
      }
      res.json(results);
      return;
    }

    // STAFF / STUDENT BRANCH
    for (const row of data) {
      // Mapping logic for Institutional Terms
      const firstName = row['Other Names'] || row.otherNames || row.firstName;
      const lastName = row['Surname'] || row.surname || row.lastName;
      const email = (row['Institutional Email'] || row.email)?.toLowerCase().trim();
      const matricNum = row['Matric Number'] || row.matricNumber;

      if (!email || !firstName || !lastName || (type === 'student' && !matricNum)) {
        results.failed.push({ row, reason: 'Missing required profile fields (Surname/Other Names/Email/Matric)' });
        continue;
      }

      // Check for existing user (Email or Matric as Username)
      const username = type === 'student' ? matricNum.toLowerCase() : email;
      const existingUser = await User.findOne({ 
        $or: [
          { email }, 
          { username }
        ] 
      });
      if (existingUser) {
        results.failed.push({ email, reason: 'User with this identity (email or matric number) already exists' });
        continue;
      }

      // Determine Programme
      let programmeId = row.programmeCode ? progMap[row.programmeCode.toLowerCase().trim()] : null;
      
      // Programme Isolation for non-admins
      if (req.user!.role !== 'admin') {
        programmeId = req.user!.programme;
      }

      // Final Role Assignment
      const role = type === 'staff' ? (row.role || 'supervisor') : 'student';
      
      if (role === 'admin') {
        results.failed.push({ email, reason: 'Bulk creation of Admin role is prohibited' });
        continue;
      }

      const tempPassword = `Acetel@${Math.floor(1000 + Math.random() * 9000)}`;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(tempPassword, salt);

      try {
        const user = new User({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email,
          username,
          password: hashedPassword,
          role,
          phone: row['Phone Number'] || row.phone,
          programme: programmeId || undefined,
          tenant: tenant._id,
          isActive: true,
        });

        await user.save();

        if (type === 'student') {
          // Check matric uniqueness additionally in student model
          const existingStu = await Student.findOne({ matricNumber: matricNum });
          if (existingStu) {
            await User.findByIdAndDelete(user._id);
            results.failed.push({ email, reason: `Matriculation Number ${matricNum} already exists` });
            continue;
          }

          const student = new Student({
            user: user._id,
            tenant: tenant._id,
            matricNumber: matricNum.trim(),
            programme: programmeId,
            academicSession: row.academicSession || '2024/2025',
            level: row.level || 'MSc',
            status: 'pending',
            personalEmail: row['Personal Email'] || row.personalEmail,
            gender: row['Gender'] || row.gender,
            isNigerian: row['Nigerianity'] === 'Non-Nigerian' ? false : true,
            address: row['Address'] || row.address
          });
          await student.save();
        }

        results.success.push({
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          username: user.username,
          tempPassword,
          role: user.role
        });

      } catch (saveErr: any) {
        results.failed.push({ email, reason: saveErr.message });
      }
    }

    // Log the bulk action
    if (results.success.length > 0) {
      await AuditLog.create({
        user: req.user!.id,
        action: 'BULK_ONBOARD',
        module: 'USER_MANAGEMENT',
        reason: `Bulk onboarded ${results.success.length} ${type} accounts`,
        details: `Successfully enrolled ${results.success.length} users. Failures: ${results.failed.length}.`,
        ipAddress: req.ip,
      });
    }

    res.json(results);
  } catch (err) {
    console.error('Bulk onboard error:', err);
    res.status(500).json({ error: 'Server error during bulk processing' });
  }
}
