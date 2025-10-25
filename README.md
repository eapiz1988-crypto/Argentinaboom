ArgentinaBoom - Fullstack with Admin
====================================

This package includes a fullstack demo where users can register freely.
Admin must approve users and set balances before users can play.
Admin credentials are stored in server/.env (ADMIN_USER, ADMIN_PASS).

Quick start:

1) Server
cd server
npm install
# edit .env to set JWT_SECRET, ADMIN_USER, ADMIN_PASS
npm start

2) Client
cd client
npm install
# set VITE_API_URL in .env or rely on default http://localhost:4000
npm run dev

Admin panel: http://localhost:5173/admin
Login using ADMIN_USER and ADMIN_PASS from server/.env

Notes:
- Demo only. Do not use for real-money gambling.
- Change JWT_SECRET and ADMIN_PASS before deploying publicly.
- The admin panel allows approving users and setting balances.
