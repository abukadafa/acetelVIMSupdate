import Student from '../models/Student.model';
import User from '../models/User.model';
import Logbook from '../models/Logbook.model';
import { sendEmail, emailTemplates } from '../utils/mail.service';

/**
 * Monitoring Job to track student engagement and logbook submissions.
 * Tiered Escalation: 3, 5, 7, 10 days of inactivity.
 */
export async function runMonitoringJob(): Promise<void> {
  console.log('🤖 Running ACETEL Multi-Tier Monitoring Job...');
  
  try {
    const activeStudents = await Student.find({ status: 'active' })
      .populate('user')
      .populate('supervisor')
      .populate('programme');

    for (const student of activeStudents) {
      const u = student.user as any;
      // Access createdAt from the document metadata
      const createdAt = (student as any).createdAt || new Date();
      const lastSeen = student.lastSeen || createdAt;
      const daysInactive = Math.floor((Date.now() - new Date(lastSeen).getTime()) / (1000 * 60 * 60 * 24));

      // 1. Update Risk Score & Level
      // Risk Score = Inactivity Days * 2
      let newRiskScore = daysInactive * 2;
      let newRiskLevel: 'Low' | 'Medium' | 'High' = 'Low';
      
      if (newRiskScore >= 20) newRiskLevel = 'High';
      else if (newRiskScore >= 10) newRiskLevel = 'Medium';

      student.riskScore = newRiskScore;
      student.riskLevel = newRiskLevel;
      await student.save();

      // 2. Escalation Logic
      if (daysInactive === 3) {
        console.log(`⚠️  3-Day Warning: ${u.firstName}`);
        await sendEmail(u.email, 'ACETEL Internship: 3-Day Activity Warning', 
          emailTemplates.inactivityWarning(u.firstName, 3));
      } 
      else if (daysInactive === 5) {
        console.log(`🚨 5-Day Escalation: ${u.firstName} -> Supervisor`);
        await sendEmail(u.email, 'ACETEL Internship: URGENT 5-Day Warning', 
          emailTemplates.inactivityWarning(u.firstName, 5));
        
        if (student.supervisor) {
          const s = student.supervisor as any;
          await sendEmail(s.email, 'Student Inactivity Alert', 
            emailTemplates.supervisorEscalation(`${u.firstName} ${u.lastName}`, s.firstName, 5));
        }
      }
      else if (daysInactive === 7) {
        console.log(`🛑 7-Day Escalation: ${u.firstName} -> Coordinator`);
        await sendEmail(u.email, 'ACETEL Internship: CRITICAL 7-Day Warning', 
          emailTemplates.inactivityWarning(u.firstName, 7));
        
        // Notify Programme Coordinator
        const coordinator = await User.findOne({ role: 'prog_coordinator' });
        if (coordinator) {
          await sendEmail(coordinator.email, 'High Risk Student Alert', 
            emailTemplates.coordinatorEscalation(`${u.firstName} ${u.lastName}`, coordinator.firstName, 7));
        }
      }
      else if (daysInactive >= 10) {
        console.log(`💀 10-Day Alert: ${u.firstName} marked as HIGH RISK`);
        // Additional institutional logic for 10+ days could go here
      }
    }
  } catch (error) {
    console.error('❌ Monitoring job failed:', error);
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
}

/**
 * Start the monitoring job at a specific interval (e.g., every 24 hours)
 */
export function startMonitoringSchedule() {
  const INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
  setInterval(runMonitoringJob, INTERVAL);
  // Run once immediately on start
  setTimeout(runMonitoringJob, 5000); 
}
