import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IFeedbackResponse {
  user: any;
  message: string;
  createdAt: Date;
}

export interface IFeedback extends Document {
  user: Types.ObjectId;
  subject: string;
  category: 'Logbook' | 'Placement' | 'Technical' | 'Support' | 'Academic';
  message: string;
  status: 'Open' | 'Assigned' | 'Closed';
  responses: IFeedbackResponse[];
  assignedTo?: Types.ObjectId;
  programme?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FeedbackSchema: Schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  subject: { type: String, required: true },
  category: { 
    type: String, 
    required: true, 
    enum: ['Logbook', 'Placement', 'Technical', 'Support', 'Academic'] 
  },
  message: { type: String, required: true },
  status: { 
    type: String, 
    required: true, 
    enum: ['Open', 'Assigned', 'Closed'], 
    default: 'Open' 
  },
  responses: [{
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    message: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User' },
  programme: { type: Schema.Types.ObjectId, ref: 'Programme' }
}, {
  timestamps: true
});

export default mongoose.model<IFeedback>('Feedback', FeedbackSchema);
