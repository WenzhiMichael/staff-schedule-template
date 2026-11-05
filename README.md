# Staff Schedule · 员工排班模板

A small-team scheduling app with English and Chinese interfaces. Employees submit next-week availability; a manager saves a draft and publishes the final roster. Use **Use this template → Create a new repository** on GitHub to start your own copy.

## Features

- Eight permanent employee slots, initially named `1–8`. Managers can rename them without losing history.
- Individual four-digit employee PINs, one-time setup/reset links, and a separate six-digit manager PIN.
- Staff see their own availability and published schedules. Manager drafts and other employees' availability stay private.
- Early/late cells, editable exact shift times, availability warnings, separate save/publish actions, and historical/future weeks.
- PDF, JPG, and Excel (.xlsx) exports; mobile layouts and Chinese/English switching.
- Monday rollover using `America/Toronto`. Weekdays use 11–18 / 18–C; weekends use 11:30–18 / 18–C. `C` means midnight.

The staff home page never shows the team list. A personal setup link binds the phone to one employee, and the home page then shows only that person and asks for their PIN. A new phone, or a browser with cleared data, needs a new link from the manager. On a shared phone, **Not you? Remove this device** removes the binding. Managers can also limit employees to seeing only their own shifts (Employees → schedule visibility), in which case other names never leave the server. Login is locked after 5 wrong PINs from one IP, or 10 from any IPs, within 15 minutes.

## Run locally

Requires Node.js **22.13+** and a **separate Neon PostgreSQL database**. This template contains no employee data, credentials, or shared database.

1. Copy this template into your own repository and clone it.
2. Run `npm ci`.
3. Run `npm run setup` and choose your own six-digit manager PIN. The prompt displays what you type. It writes an ignored `.env.local` file.
4. In `.env.local`, add `DATABASE_URL=` followed by the connection string from **your own** Neon database. Leave the manager values created by setup intact.
5. Run `npm run dev`; open `http://localhost:3000` (manager: `/manager`). Windows users can subsequently double-click `Start-Staff-Schedule.cmd`.

Tables and the eight numbered slots are initialized on the first API request. Log into the manager page, rename the slots, and generate each person's PIN setup link. Share those links privately. Resetting a link invalidates the previous PIN and employee sessions.

Data is stored in PostgreSQL, including when running locally. It is not stored in the Git repository or browser storage. Use a separate database for development. A fresh database starts empty; it never copies another installation's names or shifts.

## Deploy your copy to Vercel

1. Import **your own repository** into Vercel. Select **Vite**, use `npm ci` to install and `npm run build` to build. This project's Nitro Vercel preset generates the server output; do not configure a static-only deployment.
2. Connect your own Neon database to the project. Ensure `DATABASE_URL` (or integration-provided `POSTGRES_URL`) is set for the intended environment. Use separate databases for Preview and Production.
3. Add `STAFF_SCHEDULE_MANAGER_PIN_HASH` and `STAFF_SCHEDULE_MANAGER_SESSION_SECRET` from your local setup to Vercel's server environment variables. When copying the hash from `.env.local`, change each `\$` back to `$`. Do not include quotes or the variable-name prefix in the value.
4. Deploy. Changes to Vercel environment variables require a new deployment. Manager login is unavailable until both manager values and the database are configured.

No default PIN is included. Never prefix server secrets with `VITE_` or `NEXT_PUBLIC_`. Do not commit `.env.local`, database dumps, employee links, or credentials. Keep backups in private storage. Provider plans and limits are chosen in your own provider accounts.

## 中文快速说明

点击 GitHub 的 **Use this template** 创建自己的仓库，安装依赖后运行 `npm run setup` 设置经理 PIN，在 `.env.local` 填写自己的 Neon 数据库地址，再运行 `npm run dev`。第一次进入会建立 `1–8` 八个员工位置，经理可以改名并发送员工 PIN 设置链接。

员工填写下周时间，经理保存草稿后再发布；员工只能看到已发布的班表。姓名列表在登录前可见。所有真实资料保存在你自己的数据库，模板不附带任何真实员工资料。发布到 Vercel 前配置上述三个私密环境变量，修改配置后重新部署。

## Customize and verify

Branding is generic. Change the local SVG icon and display text in your own copy; adjust shift defaults and timezone together in server and UI utilities if needed. The first version has eight slots by design.

```sh
npm run lint
npm test
npm run build
# With a local app running:
npm run test:ui
```

Integration tests execute real route handlers against a fresh in-memory PostgreSQL engine (PGlite). They never read `.env.local` or connect to Neon. UI tests use the local server at `http://localhost:3000`, overridable with `TEST_BASE_URL`.

Built with React, TypeScript, vinext/Vite, Nitro and Neon. vinext and Nitro versions are pinned through the lockfile. Database tables are initialized by the server; no separate migration command is needed for a fresh copy. MIT licensed; dependencies retain their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
