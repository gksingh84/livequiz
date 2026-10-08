# LiveQuiz

A classroom quiz MVP with teacher-led live rounds, timed self-paced quizzes, student passkeys, persisted results, and real-time classroom updates.

## Stack

- React 19, TypeScript, Vite, and Socket.IO client
- Express 5 and Socket.IO on one Node server
- PostgreSQL 16 with Prisma ORM
- bcrypt-hashed passwords/passkeys, signed HttpOnly session cookies, Helmet, request validation, and login rate limiting

The production server serves the built React app and its API from the same origin. PostgreSQL can run locally in Docker or on any managed PostgreSQL host. No paid real-time service is required.

## Data model

- `Admin`: teacher email and bcrypt password hash.
- `Student`: name, active state, bcrypt passkey hash, and a keyed HMAC lookup value. The raw passkey is only shown when created or reset.
- `Quiz`: title, mode, draft/active/closed status, optional time limit, result visibility, and live question/reveal state.
- `Question` and `Option`: ordered prompt/options, marks, and the server-only correct option.
- `Attempt`: unique `(quizId, studentId)` pair, status, start/deadline/submission times, and server-calculated score.
- `Answer`: one row per `(attemptId, questionId)`; upserting lets students change a timed answer before submission.

Students receive only their own attempt and answers. Live response names and option choices are sent only to authenticated teacher sockets.

## Run locally

Prerequisites: Node.js 20+ and Docker Desktop (or another PostgreSQL 16 instance).

1. Install dependencies: `npm install`.
2. Create local environment settings: `Copy-Item .env.example .env` in PowerShell. Replace `SESSION_SECRET` with a random value of at least 32 characters and change the initial admin password.
3. Start PostgreSQL: `docker compose up -d db`.
4. Create/update the database schema: `npm run db:migrate`.
5. Start the API in one terminal: `npm run dev`.
6. Start the web app in another terminal: `npm run dev:web`.
7. Open `http://localhost:5173`. Sign in to the teacher view using `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The server creates the first admin automatically; `npm run db:seed` can also create/update that account.

The database volume is named `livequiz_data`; `docker compose down` leaves it intact. Do not remove the volume unless you intend to delete local quiz data.

## Deploy

Use a Node.js 20+ host and a PostgreSQL database. Set `DATABASE_URL`, `SESSION_SECRET` (32+ random characters), `ADMIN_EMAIL`, and `ADMIN_PASSWORD` as deployment secrets. Build with `npm install` and `npm run build`; run `npm start`. The app serves the client and API from the same origin, so Socket.IO uses the same secure session cookie. Enable HTTPS in production. Run `npm run db:deploy` against the production database during release before starting the new application version. This MVP uses Prisma schema synchronization; adopt checked-in migrations before making destructive database changes or coordinating multiple app versions.

The included Docker Compose file is intended for local development, not as a public production database configuration. Use a managed PostgreSQL service or a private, access-controlled PostgreSQL deployment for Internet hosting.

## MVP behavior

- Live quiz: teacher starts, reveals the correct answer, advances, and ends the round. The active prompt synchronizes over Socket.IO; answer counts, per-option distribution, and named responses update for the teacher. Students only receive quiz state and their own saved answer.
- Timed quiz: the teacher opens/closes it. The server sets each attempt deadline when the student joins, persists each answer change, grades on submit, and automatically submits expired attempts.
- Results: teacher dashboard shows student answers, scores, distributions, and CSV export. Students can revisit completed attempts and see the score when the teacher enabled result visibility.
- One attempt per student per quiz is enforced by a database unique constraint. Refreshing restores an in-progress attempt and its deadline.

## Next production steps

Before using this with a real class, set a strong session secret and admin password, use HTTPS, protect database backups, and test the deployment with a separate teacher and student browser session. For larger deployments, add email/passkey delivery workflows and operational monitoring.
