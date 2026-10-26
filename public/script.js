
const studentForm = document.getElementById("studentForm");
const attendanceDate = document.getElementById("attendanceDate");

const today = new Date();
const localDate = [
  today.getFullYear(),
  String(today.getMonth() + 1).padStart(2, "0"),
  String(today.getDate()).padStart(2, "0")
].join("-");

attendanceDate.value = localDate;
document.getElementById("reportMonth").value = localDate.slice(0, 7);

function showMessage(id, message, isError = false) {
  const element = document.getElementById(id);
  element.textContent = message;
  element.style.color = isError ? "#c62828" : "#18753b";
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

async function loadStudents() {
  try {
    const students = await api("/api/students");
    const body = document.getElementById("attendanceBody");
    body.replaceChildren();

    students.forEach(student => {
      const row = document.createElement("tr");
      row.dataset.studentId = student.id;

      [student.roll_no, student.name, student.department]
        .forEach(value => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });

      for (let period = 1; period <= 7; period++) {
        const cell = document.createElement("td");
        const select = document.createElement("select");
        select.dataset.period = period;

        ["Present", "Absent"].forEach(status => {
          const option = document.createElement("option");
          option.value = status;
          option.textContent = status;
          select.appendChild(option);
        });

        select.value = "";
        select.insertBefore(new Option("--", ""), select.firstChild);
        cell.appendChild(select);
        row.appendChild(cell);
      }

      body.appendChild(row);
    });

    await loadAttendance();
  } catch (error) {
    showMessage("attendanceMessage", error.message, true);
  }
}

studentForm.addEventListener("submit", async event => {
  event.preventDefault();

  const student = {
    roll_no: document.getElementById("rollNo").value.trim(),
    name: document.getElementById("studentName").value.trim(),
    department: document.getElementById("department").value.trim()
  };

  try {
    await api("/api/students", {
      method: "POST",
      body: JSON.stringify(student)
    });

    studentForm.reset();
    showMessage("studentMessage", "Student added successfully.");
    await loadStudents();
  } catch (error) {
    showMessage("studentMessage", error.message, true);
  }
});

async function loadAttendance() {
  try {
    const date = attendanceDate.value;
    if (!date) return;

    const records = await api(
      `/api/attendance?date=${encodeURIComponent(date)}`
    );

    document.querySelectorAll("#attendanceBody tr").forEach(row => {
      row.querySelectorAll("select").forEach(select => {
        select.value = "";
      });
    });

    records.forEach(record => {
      if (!record.period) return;

      const row = document.querySelector(
        `#attendanceBody tr[data-student-id="${record.student_id}"]`
      );

      if (row) {
        row.querySelector(
          `select[data-period="${record.period}"]`
        ).value = record.status;
      }
    });
  } catch (error) {
    showMessage("attendanceMessage", error.message, true);
  }
}

attendanceDate.addEventListener("change", loadAttendance);

function markAll(status) {
  document.querySelectorAll("#attendanceBody select").forEach(select => {
    select.value = status;
  });
}

document.getElementById("markAllPresent").addEventListener("click", () => {
  markAll("Present");
});

document.getElementById("markAllAbsent").addEventListener("click", () => {
  markAll("Absent");
});

document.getElementById("saveAttendance").addEventListener("click", async () => {
  const records = [];

  document.querySelectorAll("#attendanceBody tr").forEach(row => {
    row.querySelectorAll("select").forEach(select => {
      if (select.value) {
        records.push({
          student_id: Number(row.dataset.studentId),
          period: Number(select.dataset.period),
          status: select.value
        });
      }
    });
  });

  if (!attendanceDate.value) {
    showMessage("attendanceMessage", "Select a date first.", true);
    return;
  }

  if (records.length === 0) {
    showMessage("attendanceMessage", "Mark attendance before saving.", true);
    return;
  }

  try {
    const result = await api("/api/attendance", {
      method: "POST",
      body: JSON.stringify({
        date: attendanceDate.value,
        records
      })
    });

    showMessage("attendanceMessage", result.message);
    await loadReport();
  } catch (error) {
    showMessage("attendanceMessage", error.message, true);
  }
});

async function loadReport() {
  const month = document.getElementById("reportMonth").value;

  if (!month) {
    showMessage("reportMessage", "Select a month first.", true);
    return;
  }

  try {
    const report = await api(
      `/api/reports/monthly?month=${encodeURIComponent(month)}`
    );

    const body = document.getElementById("reportBody");
    body.replaceChildren();

    report.forEach(student => {
      const row = document.createElement("tr");

      [
        student.roll_no,
        student.name,
        student.department,
        student.working_periods,
        student.attended,
        student.absent,
        `${student.percentage}%`
      ].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = value ?? "";
        row.appendChild(cell);
      });

      body.appendChild(row);
    });

    showMessage("reportMessage", "Monthly report generated.");
  } catch (error) {
    showMessage("reportMessage", error.message, true);
  }
}

document.getElementById("loadReport").addEventListener("click", loadReport);

document.getElementById("exportReport").addEventListener("click", () => {
  const month = document.getElementById("reportMonth").value;

  if (!month) {
    showMessage("reportMessage", "Select a month first.", true);
    return;
  }

  window.location.href =
    `/api/reports/monthly/csv?month=${encodeURIComponent(month)}`;
});

loadStudents();
