import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IAuditLog extends Document {
  user?: Types.ObjectId;
  action: string;
  module: string;
  details: string;
  targetId?: Types.ObjectId;
  reason?: string;
  ipAddress?: string;
  createdAt: Date;
}

const AuditLogSchema: Schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  module: { type: String, required: true },
  details: { type: String, required: true },
  targetId: { type: Schema.Types.ObjectId },
  reason: { type: String },
  ipAddress: { type: String }
}, {
  timestamps: { createdAt: true, updatedAt: false }
});

// Index for performance
AuditLogSchema.index({ user: 1, createdAt: -1 });
AuditLogSchema.index({ module: 1 });

export default mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
