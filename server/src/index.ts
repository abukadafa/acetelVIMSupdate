import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { initDatabase } from './models/database';
import authRoutes from './routes/auth.routes';
import studentRoutes from './routes/student.routes';
import logbookRoutes from './routes/logbook.routes';
import attendanceRoutes from './routes/attendance.routes';
import companyRoutes from './routes/company.routes';
import supervisorRoutes from './routes/supervisor.routes';
import analyticsRoutes from './routes/analytics.routes';
import reportRoutes from './routes/report.routes';
import notificationRoutes from './routes/notification.routes';
import settingsRoutes from './routes/settings.routes';
import adminRoutes from './routes/admin.routes';
import feedbackRoutes from './routes/feedback.routes';
import morgan from 'morgan';
import { errorHandler } from './middleware/error.middleware';
import { startMonitoringSchedule } from './jobs/monitoring.job';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Institutional Grade Logging & Security
app.use(morgan('combined')); // Detailed production logs
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.FRONTEND_URL || '*', // Dynamic for institutional deployment
  credentials: true,
}));

// Rate limiting (Global)
const globalLimiter = rateLimit({ 
  windowMs: 15 * 60 * 1000, 
  max: 1000,
  message: 'Institutional Platform: Too many requests from this IP'
});
app.use(globalLimiter);

// Ensure data directory exists
const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Socket.IO for real-time notifications (Global Institutional Grade)
export const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const connectedUsers = new Map<string, string>();

io.on('connection', (socket) => {
  console.log('🔌 Client connected:', socket.id);
  socket.on('register', (userId: string) => {
    connectedUsers.set(userId, socket.id);
    socket.join(`user:${userId}`);
  });
  socket.on('disconnect', () => {
    connectedUsers.forEach((sid, uid) => { if (sid === socket.id) connectedUsers.delete(uid); });
  });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(uploadsDir));

// Health check
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', client: 'ACETEL PG Virtual Internship Management', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/logbook', logbookRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/companies', companyRoutes);
app.use('/api/supervisors', supervisorRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);

// GLOBAL ERROR HANDLER (MUST BE LAST)
app.use(errorHandler);

// Init DB then start server
const PORT = process.env.PORT || 5000;

initDatabase().then(() => {
  startMonitoringSchedule();
  httpServer.listen(PORT, () => {
    console.log(`\n🚀 ACETEL Virtual Internship Management Server running on port ${PORT}`);
    console.log(`📡 Socket.IO ready`);
    console.log(`🗄️  Database initialized`);
    console.log(`🌍 API: http://localhost:${PORT}/api/health\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
