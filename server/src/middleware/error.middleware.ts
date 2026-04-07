import { Request, Response, NextFunction } from 'express';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  console.error('❌ Global Error:', err.message);
  
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  
  // Don't leak stack traces in production
  const errorResponse = {
    error: message,
    status,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  };

  res.status(status).json(errorResponse);
};
