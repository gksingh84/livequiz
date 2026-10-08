import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { createServer } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Prisma, PrismaClient, type QuizMode } from '@prisma/client';
import { Server } from 'socket.io';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const port = Number(process.env.PORT ?? 4000);
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: { directives: {
    styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
  } },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false }));

const sessionCookie = 'livequiz_session';
type Role = 'admin' | 'student';
type Session = { id: string; role: Role };
type AuthRequest = Request & { session?: Session };
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 12, path: '/' };
const passkeyLookup = (passkey: string) => createHmac('sha256', secret).update(passkey.toUpperCase()).digest('hex');
const signSession = (session: Session) => jwt.sign(session, secret, { expiresIn: '12h' });
const sendSession = (res: Response, session: Session) => res.cookie(sessionCookie, signSession(session), cookieOptions);
const authenticate = (role?: Role) => async (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.cookies[sessionCookie] as string | undefined;
  try {
    const payload = jwt.verify(token ?? '', secret) as JwtPayload & Session;
    if (!payload.id || (payload.role !== 'admin' && payload.role !== 'student') || (role && payload.role !== role)) {
      return res.status(401).json({ error: 'Please sign in to continue.' });
    }
    req.session = { id: payload.id, role: payload.role };
    if (payload.role === 'student') {
      const student = await prisma.student.findUnique({ where: { id: payload.id }, select: { active: true } });
      if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Please sign in to continue.' });
  }
};
const adminOnly = authenticate('admin');
const studentOnly = authenticate('student');
const objectId = z.string().min(1).max(40);
const questionInput = z.object({
  prompt: z.string().trim().min(1).max(1000),
  marks: z.number().int().min(1).max(100),
  options: z.array(z.object({ text: z.string().trim().min(1).max(300), isCorrect: z.boolean() })).min(2).max(8)
    .refine((options) => options.filter((option) => option.isCorrect).length === 1, 'Choose exactly one correct option.'),
});
const quizInput = z.object({
  title: z.string().trim().min(1).max(120),
  mode: z.enum(['LIVE', 'SELF_PACED']),
  timeLimitSeconds: z.number().int().min(60).max(86400).nullable(),
  showResults: z.boolean(),
  questions: z.array(questionInput).min(1).max(100),
}).refine((quiz) => quiz.mode === 'LIVE' || quiz.timeLimitSeconds !== null, 'Timed quizzes need a time limit.');
const parse = <T,>(schema: z.ZodType<T>, value: unknown): T => schema.parse(value);
const errorResponse = (res: Response, error: unknown) => {
  if (error instanceof z.ZodError) return res.status(400).json({ error: error.issues[0]?.message ?? 'Invalid request.' });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return res.status(409).json({ error: 'This record already exists.' });
  console.error(error);
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
};

async function scoreAttempt(attemptId: string) {
  const attempt = await prisma.attempt.findUnique({ where: { id: attemptId }, include: { answers: { include: { option: true, question: true } } } });
  if (!attempt) return null;
  const score = attempt.answers.reduce((total, answer) => total + (answer.option.isCorrect ? answer.question.marks : 0), 0);
  return prisma.attempt.update({ where: { id: attemptId }, data: { score, status: 'SUBMITTED', submittedAt: attempt.submittedAt ?? new Date() } });
}

async function finishExpiredAttempts() {
  const expired = await prisma.attempt.findMany({ where: { status: 'IN_PROGRESS', deadlineAt: { lte: new Date() } }, select: { id: true } });
  for (const attempt of expired) await scoreAttempt(attempt.id);
}

const questionForStudent = (question: { id: string; prompt: string; marks: number; options: { id: string; text: string; isCorrect: boolean }[] }, reveal: boolean) => ({
  id: question.id,
  prompt: question.prompt,
  marks: question.marks,
  options: question.options.map(({ id, text, isCorrect }) => reveal ? { id, text, isCorrect } : { id, text }),
});

async function studentQuizState(quizId: string, studentId: string) {
  const quiz = await prisma.quiz.findUnique({
    where: { id: quizId },
    include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, attempts: { where: { studentId }, include: { answers: true } } },
  });
  if (!quiz) return null;
  const attempt = quiz.attempts[0] ?? null;
  const questions = quiz.mode === 'LIVE'
    ? quiz.questions.slice(quiz.currentQuestionIndex, quiz.currentQuestionIndex + 1)
    : quiz.questions;
  return {
    id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status,
    timeLimitSeconds: quiz.timeLimitSeconds, showResults: quiz.showResults,
    currentQuestionIndex: quiz.currentQuestionIndex, currentAnswerRevealed: quiz.currentAnswerRevealed,
    questions: questions.map((question) => questionForStudent(question, quiz.mode === 'LIVE' && quiz.currentAnswerRevealed)),
    attempt: attempt ? { id: attempt.id, status: attempt.status, startedAt: attempt.startedAt, deadlineAt: attempt.deadlineAt, submittedAt: attempt.submittedAt, score: quiz.showResults ? attempt.score : null, answers: attempt.answers.map(({ questionId, optionId }) => ({ questionId, optionId })) } : null,
  };
}

async function publishQuizState(quizId: string) {
  const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } });
  if (!quiz) return;
  const question = quiz.questions[quiz.currentQuestionIndex];
  let stats = { answered: 0, participants: 0, distribution: [] as { optionId: string; count: number }[], responses: [] as { name: string; optionId: string; text: string }[] };
  if (question) {
    const [answers, participants, responses] = await Promise.all([
      prisma.answer.groupBy({ by: ['optionId'], where: { questionId: question.id, attempt: { quizId } }, _count: { _all: true } }),
      prisma.attempt.count({ where: { quizId } }),
      prisma.answer.findMany({ where: { questionId: question.id, attempt: { quizId } }, include: { attempt: { include: { student: { select: { name: true } } } }, option: { select: { id: true, text: true } } }, orderBy: { updatedAt: 'asc' } }),
    ]);
    stats = {
      answered: answers.reduce((sum, answer) => sum + answer._count._all, 0),
      participants,
      distribution: question.options.map((option) => ({ optionId: option.id, count: answers.find((answer) => answer.optionId === option.id)?._count._all ?? 0 })),
      responses: responses.map((answer) => ({ name: answer.attempt.student.name, optionId: answer.option.id, text: answer.option.text })),
    };
  }
  const state = {
    id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status,
    currentQuestionIndex: quiz.currentQuestionIndex, currentAnswerRevealed: quiz.currentAnswerRevealed,
    questionCount: quiz.questions.length,
    question: question ? questionForStudent(question, quiz.currentAnswerRevealed) : null,
  };
  io.to(`teachers:${quizId}`).emit('quiz:state', state);
  io.to(`students:${quizId}`).emit('quiz:state', state);
  io.to(`teachers:${quizId}`).emit('quiz:stats', stats);
}

app.post('/api/auth/admin', async (req, res) => {
  try {
    const data = parse(z.object({ email: z.string().email(), password: z.string().min(1).max(200) }), req.body);
    const admin = await prisma.admin.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!admin || !(await bcrypt.compare(data.password, admin.passwordHash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    sendSession(res, { id: admin.id, role: 'admin' });
    res.json({ user: { role: 'admin', email: admin.email } });
  } catch (error) { errorResponse(res, error); }
});

app.post('/api/auth/student', async (req, res) => {
  try {
    const data = parse(z.object({ passkey: z.string().trim().min(4).max(40) }), req.body);
    const student = await prisma.student.findUnique({ where: { passkeyLookup: passkeyLookup(data.passkey) } });
    if (!student?.active || !(await bcrypt.compare(data.passkey.toUpperCase(), student.passkeyHash))) return res.status(401).json({ error: 'That passkey was not recognized.' });
    sendSession(res, { id: student.id, role: 'student' });
    res.json({ user: { role: 'student', name: student.name } });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/auth/me', authenticate(), async (req: AuthRequest, res) => {
  if (req.session?.role === 'admin') {
    const admin = await prisma.admin.findUnique({ where: { id: req.session.id }, select: { email: true } });
    return res.json({ user: admin ? { role: 'admin', email: admin.email } : null });
  }
  const student = await prisma.student.findUnique({ where: { id: req.session!.id }, select: { name: true, active: true } });
  if (!student?.active) return res.status(401).json({ error: 'This student passkey has been disabled.' });
  return res.json({ user: { role: 'student', name: student.name } });
});
app.post('/api/auth/logout', (_req, res) => res.clearCookie(sessionCookie, { ...cookieOptions, maxAge: undefined }).json({ ok: true }));

app.get('/api/quizzes', adminOnly, async (_req, res) => {
  const quizzes = await prisma.quiz.findMany({ orderBy: { updatedAt: 'desc' }, include: { _count: { select: { questions: true, attempts: true } } } });
  res.json({ quizzes });
});
app.post('/api/quizzes', adminOnly, async (req, res) => {
  try {
    const data = parse(quizInput, req.body);
    const quiz = await prisma.quiz.create({ data: {
      title: data.title, mode: data.mode as QuizMode,
      timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
      showResults: data.showResults,
      questions: { create: data.questions.map((question, position) => ({ prompt: question.prompt, marks: question.marks, position, options: { create: question.options.map((option, optionPosition) => ({ ...option, position: optionPosition })) } })) },
    } });
    res.status(201).json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/detail', adminOnly, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    res.json({ quiz });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/quizzes/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(quizInput, req.body);
    const existing = await prisma.quiz.findUnique({ where: { id }, include: { _count: { select: { attempts: true } } } });
    if (!existing) return res.status(404).json({ error: 'Quiz not found.' });
    if (existing.status === 'ACTIVE' || existing._count.attempts > 0) return res.status(409).json({ error: 'A quiz with active or submitted attempts cannot be edited.' });
    await prisma.$transaction(async (tx) => {
      await tx.question.deleteMany({ where: { quizId: id } });
      await tx.quiz.update({ where: { id }, data: {
        title: data.title, mode: data.mode as QuizMode, timeLimitSeconds: data.mode === 'LIVE' ? null : data.timeLimitSeconds,
        showResults: data.showResults, currentQuestionIndex: 0, currentAnswerRevealed: false,
        questions: { create: data.questions.map((question, position) => ({ prompt: question.prompt, marks: question.marks, position, options: { create: question.options.map((option, optionPosition) => ({ ...option, position: optionPosition })) } })) },
      } });
    });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/quizzes/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    await prisma.quiz.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/quizzes/:id/status', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const { action } = parse(z.object({ action: z.enum(['start', 'stop']) }), req.body);
    const quiz = await prisma.quiz.findUnique({ where: { id } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    if (quiz.mode !== 'SELF_PACED') return res.status(400).json({ error: 'Use live controls for a classroom quiz.' });
    if (action === 'start' && quiz.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft quiz can be opened.' });
    if (action === 'stop' && quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not open.' });
    await prisma.quiz.update({ where: { id }, data: { status: action === 'start' ? 'ACTIVE' : 'CLOSED' } });
    if (action === 'stop') {
      const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
      for (const attempt of attempts) await scoreAttempt(attempt.id);
    }
    await publishQuizState(id);
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/quizzes/:id/control', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const { action } = parse(z.object({ action: z.enum(['start', 'next', 'reveal', 'stop']) }), req.body);
    const quiz = await prisma.quiz.findUnique({ where: { id }, include: { _count: { select: { questions: true } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    if (quiz.mode !== 'LIVE') return res.status(400).json({ error: 'Only live quizzes have teacher controls.' });
    if (action === 'start') {
      if (quiz.status !== 'DRAFT') return res.status(409).json({ error: 'Only a draft quiz can be started.' });
      await prisma.quiz.update({ where: { id }, data: { status: 'ACTIVE', currentQuestionIndex: 0, currentAnswerRevealed: false } });
    } else if (action === 'next') {
      if (quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not active.' });
      const nextIndex = quiz.currentQuestionIndex + 1;
      if (nextIndex >= quiz._count.questions) {
        await prisma.quiz.update({ where: { id }, data: { status: 'CLOSED' } });
        const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
        for (const attempt of attempts) await scoreAttempt(attempt.id);
      } else {
        await prisma.quiz.update({ where: { id }, data: { currentQuestionIndex: nextIndex, currentAnswerRevealed: false } });
      }
    } else if (action === 'reveal') {
      if (quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is not active.' });
      await prisma.quiz.update({ where: { id }, data: { currentAnswerRevealed: true } });
    } else {
      await prisma.quiz.update({ where: { id }, data: { status: 'CLOSED' } });
      const attempts = await prisma.attempt.findMany({ where: { quizId: id, status: 'IN_PROGRESS' }, select: { id: true } });
      for (const attempt of attempts) await scoreAttempt(attempt.id);
    }
    await publishQuizState(id);
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/students', adminOnly, async (_req, res) => {
  const students = await prisma.student.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, active: true, createdAt: true, _count: { select: { attempts: true } } } });
  res.json({ students });
});
app.post('/api/students', adminOnly, async (req, res) => {
  try {
    const data = parse(z.object({ name: z.string().trim().min(1).max(100) }), req.body);
    const passkey = randomBytes(8).toString('hex').toUpperCase();
    const student = await prisma.student.create({ data: { name: data.name, passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) }, select: { id: true, name: true, active: true } });
    res.status(201).json({ student, passkey });
  } catch (error) { errorResponse(res, error); }
});
app.patch('/api/students/:id', adminOnly, async (req, res) => {
  try {
    const id = parse(objectId, req.params.id);
    const data = parse(z.object({ active: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional(), resetPasskey: z.boolean().optional() }), req.body);
    const passkey = data.resetPasskey ? randomBytes(8).toString('hex').toUpperCase() : null;
    const student = await prisma.student.update({ where: { id }, data: { active: data.active, name: data.name, ...(passkey ? { passkeyHash: await bcrypt.hash(passkey, 12), passkeyLookup: passkeyLookup(passkey) } : {}) }, select: { id: true, name: true, active: true } });
    res.json({ student, ...(passkey ? { passkey } : {}) });
  } catch (error) { errorResponse(res, error); }
});
app.delete('/api/students/:id', adminOnly, async (req, res) => {
  try { await prisma.student.delete({ where: { id: parse(objectId, req.params.id) } }); res.json({ ok: true }); }
  catch (error) { errorResponse(res, error); }
});
app.get('/api/quizzes/:id/results', adminOnly, async (req, res) => {
  try {
    const quiz = await prisma.quiz.findUnique({ where: { id: parse(objectId, req.params.id) }, include: { questions: { orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } }, attempts: { include: { student: { select: { name: true } }, answers: { include: { question: true, option: true } } }, orderBy: { startedAt: 'asc' } } } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    const totalMarks = quiz.questions.reduce((sum, question) => sum + question.marks, 0);
    const results = quiz.attempts.map((attempt) => ({ id: attempt.id, name: attempt.student.name, status: attempt.status, startedAt: attempt.startedAt, submittedAt: attempt.submittedAt, score: attempt.score, totalMarks, answers: attempt.answers.map((answer) => ({ questionId: answer.questionId, question: answer.question.prompt, response: answer.option.text, correct: answer.option.isCorrect, marks: answer.question.marks })) }));
    const distribution = quiz.questions.map((question) => ({ question: question.prompt, options: question.options.map((option) => ({ text: option.text, correct: option.isCorrect, count: quiz.attempts.reduce((count, attempt) => count + attempt.answers.filter((answer) => answer.optionId === option.id).length, 0) })) }));
    res.json({ quiz: { id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status }, results, distribution });
  } catch (error) { errorResponse(res, error); }
});

app.get('/api/student/quizzes', studentOnly, async (req: AuthRequest, res) => {
  await finishExpiredAttempts();
  const studentId = req.session!.id;
  const quizzes = await prisma.quiz.findMany({ where: { OR: [
    { status: 'ACTIVE', attempts: { none: { studentId, status: 'SUBMITTED' } } },
    { attempts: { some: { studentId } } },
  ] }, orderBy: { createdAt: 'desc' }, include: { _count: { select: { questions: true } }, attempts: { where: { studentId }, select: { status: true, deadlineAt: true, score: true } } } });
  res.json({ quizzes: quizzes.map((quiz) => ({ id: quiz.id, title: quiz.title, mode: quiz.mode, status: quiz.status, timeLimitSeconds: quiz.timeLimitSeconds, questionCount: quiz._count.questions, attempt: quiz.attempts[0] ?? null })) });
});
app.get('/api/student/quizzes/:id', studentOnly, async (req: AuthRequest, res) => {
  try {
    await finishExpiredAttempts();
    const id = parse(objectId, req.params.id);
    const quiz = await prisma.quiz.findUnique({ where: { id }, select: { id: true, status: true, mode: true, timeLimitSeconds: true } });
    if (!quiz) return res.status(404).json({ error: 'Quiz not found.' });
    let attempt = await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId: id, studentId: req.session!.id } } });
    if (!attempt && quiz.status === 'ACTIVE') {
      const now = new Date();
      attempt = await prisma.attempt.upsert({
        where: { quizId_studentId: { quizId: id, studentId: req.session!.id } },
        update: {},
        create: { quizId: id, studentId: req.session!.id, deadlineAt: quiz.mode === 'SELF_PACED' ? new Date(now.getTime() + (quiz.timeLimitSeconds ?? 0) * 1000) : null },
      });
    }
    if (!attempt) return res.status(409).json({ error: 'This quiz is not open for you.' });
    res.json({ quiz: await studentQuizState(id, req.session!.id) });
  } catch (error) { errorResponse(res, error); }
});
app.put('/api/student/quizzes/:id/answers', studentOnly, async (req: AuthRequest, res) => {
  try {
    await finishExpiredAttempts();
    const quizId = parse(objectId, req.params.id);
    const { questionId, optionId } = parse(z.object({ questionId: objectId, optionId: objectId }), req.body);
    const [quiz, attempt, option] = await Promise.all([
      prisma.quiz.findUnique({ where: { id: quizId } }),
      prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: req.session!.id } } }),
      prisma.option.findUnique({ where: { id: optionId }, include: { question: true } }),
    ]);
    if (!quiz || !attempt || attempt.status !== 'IN_PROGRESS' || quiz.status !== 'ACTIVE') return res.status(409).json({ error: 'This quiz is no longer accepting answers.' });
    if (!option || option.questionId !== questionId) return res.status(400).json({ error: 'That answer does not belong to this question.' });
    if (quiz.mode === 'LIVE' && (questionId !== (await prisma.question.findFirst({ where: { quizId, position: quiz.currentQuestionIndex }, select: { id: true } }))?.id || quiz.currentAnswerRevealed)) return res.status(409).json({ error: 'The live question has changed or has been revealed.' });
    await prisma.answer.upsert({ where: { attemptId_questionId: { attemptId: attempt.id, questionId } }, create: { attemptId: attempt.id, questionId, optionId }, update: { optionId } });
    if (quiz.mode === 'LIVE') await publishQuizState(quizId);
    res.json({ ok: true });
  } catch (error) { errorResponse(res, error); }
});
app.post('/api/student/quizzes/:id/submit', studentOnly, async (req: AuthRequest, res) => {
  try {
    await finishExpiredAttempts();
    const quizId = parse(objectId, req.params.id);
    const attempt = await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: req.session!.id } } });
    if (!attempt) return res.status(404).json({ error: 'Quiz attempt not found.' });
    const submitted = attempt.status === 'SUBMITTED' ? attempt : await scoreAttempt(attempt.id);
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { showResults: true } });
    res.json({ submitted: true, score: quiz?.showResults ? submitted?.score : null });
  } catch (error) { errorResponse(res, error); }
});

io.use(async (socket, next) => {
  const cookie = socket.handshake.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookie}=`));
  try {
    const token = cookie?.slice(sessionCookie.length + 1) ?? '';
    const payload = jwt.verify(token, secret) as JwtPayload & Session;
    if (!payload.id || (payload.role !== 'admin' && payload.role !== 'student')) return next(new Error('Unauthorized'));
    if (payload.role === 'student' && !(await prisma.student.findFirst({ where: { id: payload.id, active: true }, select: { id: true } }))) return next(new Error('Unauthorized'));
    socket.data.session = { id: payload.id, role: payload.role } satisfies Session;
    next();
  } catch { next(new Error('Unauthorized')); }
});
io.on('connection', (socket) => {
  socket.on('watch:quiz', async (quizId: string) => {
    if (typeof quizId !== 'string') return;
    const quiz = await prisma.quiz.findUnique({ where: { id: quizId }, select: { id: true, status: true } });
    if (!quiz) return;
    const session = socket.data.session as Session;
    if (session.role === 'admin') socket.join(`teachers:${quizId}`);
    else if (quiz.status === 'ACTIVE' && await prisma.attempt.findUnique({ where: { quizId_studentId: { quizId, studentId: session.id } }, select: { id: true } })) socket.join(`students:${quizId}`);
    await publishQuizState(quizId);
  });
});

app.use(express.static(resolve('dist')));
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(resolve('dist/index.html'), (error) => { if (error) next(error); });
});
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => errorResponse(res, error));

setInterval(() => { void finishExpiredAttempts(); }, 5000).unref();
async function startServer() {
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
    await prisma.admin.upsert({ where: { email: process.env.ADMIN_EMAIL.toLowerCase() }, update: {}, create: { email: process.env.ADMIN_EMAIL.toLowerCase(), passwordHash } });
  }
  httpServer.listen(port, '0.0.0.0', () => console.log(`LiveQuiz server listening on port ${port}`));
}
void startServer();
