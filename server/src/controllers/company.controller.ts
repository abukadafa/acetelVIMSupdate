import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Company from '../models/Company.model';
import Student from '../models/Student.model';

export async function getAllCompanies(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { state, sector, specialisation, search, isApproved } = req.query;
    let query: any = {};

    if (state) query.state = state;
    if (sector) query.sector = sector;
    if (specialisation) query.specialisation = specialisation;
    if (isApproved !== undefined) query.isApproved = isApproved === 'true';
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } },
        { specialisation: { $regex: search, $options: 'i' } },
        { sector: { $regex: search, $options: 'i' } }
      ];
    }

    const companies = await Company.find(query).sort({ name: 1 });
    
    // Add student count to each company
    const companiesWithCount = await Promise.all(
      companies.map(async (c) => {
        const studentCount = await Student.countDocuments({ company: c._id });
        return { ...c.toObject(), studentCount };
      })
    );

    res.json({ companies: companiesWithCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function createCompany(req: AuthRequest, res: Response): Promise<void> {
  try {
    const companyData = req.body;
    const company = new Company(companyData);
    await company.save();
    res.status(201).json({ message: 'Company created', id: company._id, company });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function updateCompany(req: AuthRequest, res: Response): Promise<void> {
  try {
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    res.json({ message: 'Company updated', company });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function deleteCompany(req: AuthRequest, res: Response): Promise<void> {
  try {
    const studentCount = await Student.countDocuments({ company: req.params.id });
    if (studentCount > 0) {
      res.status(400).json({ error: 'Cannot delete company with assigned students' });
      return;
    }
    const company = await Company.findByIdAndDelete(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    res.json({ message: 'Company deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getCompanyById(req: AuthRequest, res: Response): Promise<void> {
  try {
    const company = await Company.findById(req.params.id);
    if (!company) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const students = await Student.find({ company: company._id })
      .populate('user', 'firstName lastName')
      .populate('programme', 'name level');
    
    res.json({ company, students });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function getCompanyMetadata(_req: Request, res: Response): Promise<void> {
  try {
    const states = await Company.distinct('state');
    const sectors = await Company.distinct('sector');
    const specialisations = await Company.distinct('specialisation');
    res.json({ 
      states: states.sort(), 
      sectors: sectors.sort(),
      specialisations: specialisations.sort()
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
