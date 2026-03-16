# ⬡ FaceAttend PRO — AI Hybrid Attendance System

> Face Recognition + QR Code + Live Charts Dashboard — 100% Free

[![Live Demo](https://img.shields.io/badge/Live-Demo-00F5D4?style=for-the-badge)](https://YOUR_USERNAME.github.io/face-attendance)
[![GitHub Pages](https://img.shields.io/badge/Hosted-GitHub_Pages-7C3AED?style=for-the-badge)](https://pages.github.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)](LICENSE)

---

## ✨ Features

| Feature | Details |
|---|---|
| 🤖 **Face Recognition** | Real-time AI face detection via face-api.js |
| 📱 **QR Code Attendance** | Each student gets a unique QR code |
| ⬡ **Hybrid Mode** | Face OR QR — whichever is scanned first marks attendance |
| 📊 **Live Dashboard** | Weekly bar chart, today's donut chart, hourly trend |
| ☁️ **Google Sheets** | Attendance syncs to Google Sheets automatically |
| 🔐 **Owner Auth** | Secure login with customizable credentials |
| 📤 **CSV Export** | Download attendance as CSV any time |
| 🆓 **100% Free** | No paid APIs, no subscriptions, no server required |

---

## 🚀 Tech Stack

```
face-api.js      →  Face recognition (TensorFlow.js)
jsQR             →  QR code scanning (browser-based)
QRCode.js        →  QR code generation
Chart.js         →  Dashboard charts
Google Sheets    →  Free cloud database
Google Apps Script → Free serverless backend
GitHub Pages     →  Free hosting with HTTPS
```

---

## 🛠 Setup (15 minutes)

### 1. Fork & Enable GitHub Pages
```bash
# Fork this repo, then in Settings → Pages → Deploy from main
# Your URL: https://YOUR_USERNAME.github.io/face-attendance
```

### 2. Google Sheets Backend
1. Create a Google Sheet → copy the Sheet ID from URL
2. Go to [script.google.com](https://script.google.com) → New project
3. Paste `google-apps-script.js` contents
4. Replace `YOUR_GOOGLE_SHEET_ID_HERE` with your Sheet ID
5. **Deploy → Web App → Anyone → Deploy** → copy the URL
6. In FaceAttend → Settings → paste the URL

### 3. Login
| Field | Default |
|---|---|
| Username | `admin` |
| Password | `admin123` |

**⚠️ Change your password in Settings immediately!**

---

## 📱 How It Works

```
Register Student
    ↓
Capture Face → Stored as descriptor (browser localStorage)
Generate QR  → Print and give to student

Take Attendance (Hybrid Mode)
    ↓
Camera scans → Face recognized?  ✓ → Mark present
             → QR code scanned?  ✓ → Mark present
             → Sync to Google Sheets
             → Dashboard updates live
```

---

## 📊 Dashboard Charts

- **Weekly Bar Chart** — 7-day attendance trend (Present vs Absent)
- **Today's Donut** — Present/Absent ratio + percentage  
- **Hourly Trend** — When students arrive (7AM–6PM)
- **Recent Activity Feed** — Live log with Face/QR method tags

---

## 📁 Project Structure

```
face-attendance/
├── index.html              # Main SPA application
├── style.css               # Cyberpunk dark theme
├── app.js                  # All logic (Face + QR + Charts)
├── google-apps-script.js   # Paste into Google Apps Script
└── README.md
```

---

## 🔒 Privacy

- Face descriptors stored in **browser localStorage only**
- **No face images ever uploaded** to any server
- Only text data (name, ID, time) sent to Google Sheets

---

## 🎯 Resume Highlights

> "Built a full-stack AI attendance system with face recognition, QR scanning, and real-time analytics dashboard. Deployed on GitHub Pages with Google Sheets cloud backend — zero infrastructure cost."

**Skills demonstrated:** Computer Vision, JavaScript, REST APIs, Data Visualization, Cloud Integration, UI/UX

---

## 📄 License

MIT — free to use and build upon.
