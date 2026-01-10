// State
let contacts = [];
let chart = null;
let currentMonthlyData = null;
let currentView = 'month';

// DOM elements
const contactList = document.getElementById('contact-list');
const searchInput = document.getElementById('search');
const welcome = document.getElementById('welcome');
const chartContainer = document.getElementById('chart-container');
const contactNameEl = document.getElementById('contact-name');
const statTotal = document.getElementById('stat-total');
const statSent = document.getElementById('stat-sent');
const statReceived = document.getElementById('stat-received');
const toggleButtons = document.querySelectorAll('.toggle button');

// Format numbers with commas
function formatNumber(n) {
  return n.toLocaleString();
}

// Aggregate monthly data to yearly
function aggregateToYearly(monthly) {
  const yearly = {};
  for (const m of monthly) {
    const year = m.month.substring(0, 4);
    if (!yearly[year]) {
      yearly[year] = { year, sent: 0, received: 0 };
    }
    yearly[year].sent += m.sent;
    yearly[year].received += m.received;
  }
  return Object.values(yearly).sort((a, b) => a.year.localeCompare(b.year));
}

// Render contact list
function renderContacts(filter = '') {
  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  contactList.innerHTML = filtered.map(c => `
    <li data-filename="${c.filename}" data-name="${c.name}"
        data-total="${c.total}" data-sent="${c.sent}" data-received="${c.received}">
      <div class="contact-name">${c.name}</div>
      <div class="contact-meta">${formatNumber(c.total)}</div>
    </li>
  `).join('');
}

// Load and display chart for a contact
async function loadContact(filename, name, total, sent, received) {
  // Update active state
  document.querySelectorAll('#contact-list li').forEach(li => {
    li.classList.toggle('active', li.dataset.filename === filename);
  });

  // Update header stats
  contactNameEl.textContent = name;
  statTotal.textContent = formatNumber(total);
  statSent.textContent = formatNumber(sent);
  statReceived.textContent = formatNumber(received);

  // Show chart container
  welcome.style.display = 'none';
  chartContainer.style.display = 'flex';

  // Fetch monthly data
  try {
    const response = await fetch(`data/messages/${filename}.json`);
    const data = await response.json();
    currentMonthlyData = data.monthly;
    renderChart();
  } catch (err) {
    console.error('Failed to load contact data:', err);
  }
}

// Render the chart based on current view
function renderChart() {
  if (!currentMonthlyData) return;

  const ctx = document.getElementById('chart').getContext('2d');

  // Destroy existing chart
  if (chart) {
    chart.destroy();
  }

  let data, labels, tooltipFormat;

  if (currentView === 'year') {
    const yearly = aggregateToYearly(currentMonthlyData);
    data = yearly;
    labels = yearly.map(y => y.year);
    tooltipFormat = (item) => item.year;
  } else {
    data = currentMonthlyData;
    labels = currentMonthlyData.map(m => {
      const [year, month] = m.month.split('-');
      const date = new Date(year, month - 1);
      // Show year on January or first item
      if (month === '01' || m === currentMonthlyData[0]) {
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      }
      return date.toLocaleDateString('en-US', { month: 'short' });
    });
    tooltipFormat = (item) => {
      const [year, month] = item.month.split('-');
      return new Date(year, month - 1).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long'
      });
    };
  }

  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'sent',
          data: data.map(d => d.sent),
          backgroundColor: '#34d399',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
        {
          label: 'recv',
          data: data.map(d => d.received),
          backgroundColor: '#60a5fa',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleColor: '#999',
          bodyColor: '#ccc',
          borderColor: '#333',
          borderWidth: 1,
          padding: 12,
          titleFont: { family: 'SF Mono, Monaco, monospace', size: 11 },
          bodyFont: { family: 'SF Mono, Monaco, monospace', size: 12 },
          displayColors: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return tooltipFormat(data[idx]);
            },
            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)}`,
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const total = data[idx].sent + data[idx].received;
              return `\n total: ${formatNumber(total)}`;
            }
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { color: '#333' },
          ticks: {
            color: '#666',
            font: { family: 'SF Mono, Monaco, monospace', size: 10 },
            maxRotation: 45,
            minRotation: 45
          }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#1a1a1a' },
          border: { display: false },
          ticks: {
            color: '#555',
            font: { family: 'SF Mono, Monaco, monospace', size: 10 },
            callback: (v) => formatNumber(v)
          }
        }
      }
    }
  });
}

// Event listeners
contactList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (li) {
    loadContact(
      li.dataset.filename,
      li.dataset.name,
      parseInt(li.dataset.total),
      parseInt(li.dataset.sent),
      parseInt(li.dataset.received)
    );
  }
});

searchInput.addEventListener('input', (e) => {
  renderContacts(e.target.value);
});

// Toggle view
toggleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    toggleButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = btn.dataset.view;
    renderChart();
  });
});

// Initialize
async function init() {
  try {
    const response = await fetch('data/contacts.json');
    contacts = await response.json();
    renderContacts();
  } catch (err) {
    console.error('Failed to load contacts:', err);
    contactList.innerHTML = '<li>run export_json.py first</li>';
  }
}

init();
