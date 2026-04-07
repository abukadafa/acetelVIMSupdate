import mongoose, { Schema, Document } from 'mongoose';

export interface IProgramme extends Document {
  code: string;
  name: string;
  level: 'MSc' | 'PhD' | 'PGD';
  durationMonths: number;
  isActive: boolean;
}

const ProgrammeSchema: Schema = new Schema({
  code: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  level: { type: String, enum: ['MSc', 'PhD', 'PGD'], required: true },
  durationMonths: { type: Number, default: 18 },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

export default mongoose.model<IProgramme>('Programme', ProgrammeSchema);
