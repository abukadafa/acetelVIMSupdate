import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import Notification from '../models/Notification.model';

export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  try {
    const notifications = await Notification.find({ user: req.user!.id })
      .sort({ createdAt: -1 })
      .limit(50);
    
    const unreadCount = await Notification.countDocuments({ 
      user: req.user!.id, 
      isRead: false 
    });
    
    res.json({ notifications, unreadCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function markAsRead(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (req.params.id === 'all') {
      await Notification.updateMany(
        { user: req.user!.id }, 
        { $set: { isRead: true } }
      );
    } else {
      await Notification.findOneAndUpdate(
        { _id: req.params.id, user: req.user!.id },
        { $set: { isRead: true } }
      );
    }
    res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}

export async function deleteNotification(req: AuthRequest, res: Response): Promise<void> {
  try {
    await Notification.findOneAndDelete({ 
      _id: req.params.id, 
      user: req.user!.id 
    });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
}
