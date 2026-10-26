
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Connect to SQLite database
const db = new sqlite3.Database(
  path.join(__dirname, "attendance.db"),
  (err) => {
    if (err) {
      console.error("Database connection failed:", err.message);
    } else {
      console.log("SQLite database connected successfully.");
    }
  }
);

// Create database tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_no TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      department TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      period INTEGER NOT NULL CHECK(period BETWEEN 1 AND 7),
      status TEXT NOT NULL CHECK(status IN ('Present', 'Absent')),
      UNIQUE(student_id, date, period),
      FOREIGN KEY(student_id) REFERENCES students(id)
    )
  `);
});

// Check whether the server is running
app.get("/api/health", (req, res) => {
  res.json({ message: "Attendance system is running!" });
});

// Get all students
app.get("/api/students", (req, res) => {
  db.all("SELECT * FROM students ORDER BY roll_no", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Add a student
app.post("/api/students", (req, res) => {
  const { roll_no, name, department } = req.body;

  if (
    !roll_no?.trim() ||
    !name?.trim() ||
    !department?.trim()
  ) {
    return res.status(400).json({
      error: "Roll number, name and department are required."
    });
  }

  db.run(
    "INSERT INTO students (roll_no, name, department) VALUES (?, ?, ?)",
    [roll_no.trim(), name.trim(), department.trim()],
    function (err) {
      if (err) {
        const status = err.message.includes("UNIQUE") ? 409 : 500;
        return res.status(status).json({
          error: status === 409
            ? "This roll number already exists."
            : err.message
        });
      }

      res.status(201).json({
        id: this.lastID,
        roll_no: roll_no.trim(),
        name: name.trim(),
        department: department.trim()
      });
    }
  );
});

// Edit student details
app.put("/api/students/:id", (req, res) => {
  const { roll_no, name, department } = req.body;

  if (
    !roll_no?.trim() ||
    !name?.trim() ||
    !department?.trim()
  ) {
    return res.status(400).json({
      error: "All student details are required."
    });
  }

  db.run(
    `UPDATE students
     SET roll_no = ?, name = ?, department = ?
     WHERE id = ?`,
    [
      roll_no.trim(),
      name.trim(),
      department.trim(),
      req.params.id
    ],
    function (err) {
      if (err) {
        const status = err.message.includes("UNIQUE") ? 409 : 500;
        return res.status(status).json({ error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: "Student not found." });
      }

      res.json({ message: "Student details updated successfully." });
    }
  );
});

// Get attendance for a selected date
app.get("/api/attendance", (req, res) => {
  const { date } = req.query;

  if (!date) {
    return res.status(400).json({ error: "Please select a date." });
  }

  db.all(
    `SELECT s.id AS student_id, s.roll_no, s.name,
            s.department, a.period, a.status
     FROM students s
     LEFT JOIN attendance a
       ON s.id = a.student_id AND a.date = ?
     ORDER BY s.roll_no, a.period`,
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Save attendance for multiple students and periods
app.post("/api/attendance", (req, res) => {
  const { date, records } = req.body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A valid date is required." });
  }

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: "No attendance records provided." });
  }

  const valid = records.every((r) =>
    Number.isInteger(Number(r.student_id)) &&
    Number.isInteger(Number(r.period)) &&
    Number(r.period) >= 1 &&
    Number(r.period) <= 7 &&
    ["Present", "Absent"].includes(r.status)
  );

  if (!valid) {
    return res.status(400).json({
      error: "Check student IDs, periods and attendance statuses."
    });
  }

  db.serialize(() => {
    db.run("BEGIN TRANSACTION");

    const stmt = db.prepare(`
      INSERT INTO attendance (student_id, date, period, status)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(student_id, date, period)
      DO UPDATE SET status = excluded.status
    `);

    let failed = false;
    let pending = records.length;

    records.forEach((r) => {
      stmt.run(
        [Number(r.student_id), date, Number(r.period), r.status],
        (err) => {
          if (err && !failed) {
            failed = true;
            db.run("ROLLBACK");
            return res.status(400).json({
              error: "Could not save attendance. Check that the students exist."
            });
          }

          if (failed) return;

          pending--;

          if (pending === 0) {
            stmt.finalize((finalizeErr) => {
              if (finalizeErr) {
                db.run("ROLLBACK");
                return res.status(500).json({ error: finalizeErr.message });
              }

              db.run("COMMIT", (commitErr) => {
                if (commitErr) {
                  return res.status(500).json({ error: commitErr.message });
                }

                res.json({ message: "Attendance saved successfully." });
              });
            });
          }
        }
      );
    });
  });
});

// Get monthly attendance summary
app.get("/api/reports/monthly", (req, res) => {
  const { month } = req.query;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({
      error: "Select a month in YYYY-MM format."
    });
  }

  db.all(
    `SELECT s.id, s.roll_no, s.name, s.department,
            COALESCE(SUM(
              CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END
            ), 0) AS attended,
            COALESCE(SUM(
              CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END
            ), 0) AS absent
     FROM students s
     LEFT JOIN attendance a
       ON s.id = a.student_id AND substr(a.date, 1, 7) = ?
     GROUP BY s.id
     ORDER BY s.roll_no`,
    [month],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get(
        `SELECT COUNT(DISTINCT date) AS working_days
         FROM attendance
         WHERE substr(date, 1, 7) = ?`,
        [month],
        (dayErr, result) => {
          if (dayErr) {
            return res.status(500).json({ error: dayErr.message });
          }

          const workingPeriods = result.working_days * 7;

          const report = rows.map((student) => ({
            ...student,
            working_periods: workingPeriods,
            percentage: workingPeriods
              ? Number((student.attended / workingPeriods * 100).toFixed(2))
              : 0
          }));

          res.json(report);
        }
      );
    }
  );
});

// Export monthly attendance as CSV
app.get("/api/reports/monthly/csv", (req, res) => {
  const { month } = req.query;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Select a valid month." });
  }

  db.all(
    `SELECT s.roll_no, s.name, s.department,
            SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS attended,
            SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent,
            COUNT(DISTINCT a.date) AS recorded_days
     FROM students s
     LEFT JOIN attendance a
       ON s.id = a.student_id AND substr(a.date, 1, 7) = ?
     GROUP BY s.id
     ORDER BY s.roll_no`,
    [month],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get(
        `SELECT COUNT(DISTINCT date) AS days
         FROM attendance WHERE substr(date, 1, 7) = ?`,
        [month],
        (dayErr, result) => {
          if (dayErr) {
            return res.status(500).json({ error: dayErr.message });
          }

          const workingPeriods = result.days * 7;
          const escapeCsv = (value) =>
            `"${String(value ?? "").replace(/"/g, '""')}"`;

          const lines = [
            ["Roll Number", "Name", "Department", "Working Periods",
             "Attended", "Absent", "Attendance Percentage"].join(","),
            ...rows.map((s) => [
              s.roll_no,
              s.name,
              s.department,
              workingPeriods,
              s.attended || 0,
              s.absent || 0,
              workingPeriods
                ? ((s.attended || 0) / workingPeriods * 100).toFixed(2) + "%"
                : "0%"
            ].map(escapeCsv).join(","))
          ];

          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="attendance-${month}.csv"`
          );
          res.send(lines.join("\r\n"));
        }
      );
    }
  );
});

// Start the server
app.listen(PORT, () => {
  console.log(`Attendance system running at http://localhost:${PORT}`);
});
