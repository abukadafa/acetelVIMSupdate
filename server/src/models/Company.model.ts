import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ICompany extends Document {
  name: string;
  address?: string;
  state?: string;
  lga?: string;
  sector?: 'AI' | 'CS' | 'MIS' | 'Cybersecurity' | 'Data Science' | 'General IT';
  specialisation?: string;
  contactPerson?: string;
  contactEmail?: string;
  contactPhone?: string;
  lat?: number;
  lng?: number;
  maxStudents: number;
  currentStudents: number;
  isApproved: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  deletedBy?: Types.ObjectId;
  deleteReason?: string;
}

const CompanySchema: Schema = new Schema({
  name: { type: String, required: true },
  address: { type: String },
  state: { type: String, required: true },
  lga: { type: String },
  sector: { 
    type: String, 
    enum: ['AI', 'CS', 'MIS', 'Cybersecurity', 'Data Science', 'General IT'],
    default: 'General IT'
  },
  specialisation: { type: String },
  contactPerson: { type: String },
  contactEmail: { type: String },
  contactPhone: { type: String },
  lat: { type: Number },
  lng: { type: Number },
  maxStudents: { type: Number, default: 5 },
  currentStudents: { type: Number, default: 0 },
  isApproved: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  deleteReason: { type: String }
}, {
  timestamps: true
});

export default mongoose.model<ICompany>('Company', CompanySchema);
