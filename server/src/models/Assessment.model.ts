import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAssessment extends Document {
  student: Types.ObjectId;
  supervisor: Types.ObjectId;
  type: 'mid_term' | 'final' | 'monthly';
  period: string;
  punctuality: number;
  attitude: number;
  technicalSkills: number;
  communication: number;
  initiative: number;
  overallScore: number;
  comments?: string;
}

const AssessmentSchema: Schema = new Schema({
  student: { type: Schema.Types.ObjectId, ref: 'Student', required: true },
  supervisor: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { 
    type: String, 
    enum: ['mid_term', 'final', 'monthly'],
    required: true 
  },
  period: { type: String, required: true },
  punctuality: { type: Number, min: 1, max: 10, default: 0 },
  attitude: { type: Number, min: 1, max: 10, default: 0 },
  technicalSkills: { type: Number, min: 1, max: 10, default: 0 },
  communication: { type: Number, min: 1, max: 10, default: 0 },
  initiative: { type: Number, min: 1, max: 10, default: 0 },
  overallScore: { type: Number, default: 0 },
  comments: { type: String }
}, {
  timestamps: true
});

// Calculate overall score automatically
AssessmentSchema.pre<IAssessment>('save', async function() {
  const sum = (this.punctuality || 0) + (this.attitude || 0) + (this.technicalSkills || 0) + (this.communication || 0) + (this.initiative || 0);
  this.overallScore = sum / 5;
});

export default mongoose.model<IAssessment>('Assessment', AssessmentSchema);
