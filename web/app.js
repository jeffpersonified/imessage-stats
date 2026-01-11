// State
let contacts = [];
let chart = null;
let currentContactData = null;
let currentView = 'month';
let currentFirstName = '';
let everyoneData = null;
let currentYearFilter = 'all';
let isEveryoneView = false;
let isNavigatingFromPopState = false; // Flag to avoid duplicate history entries

// Fake names for screenshots (use with ./scripts/start --fake)
const FAKE_MODE = new URLSearchParams(window.location.search).has('fake');
const fakeNames = [
  'Emma Rodriguez', 'Liam Chen', 'Olivia Patel', 'Noah Kim', 'Ava Thompson',
  'Ethan Nakamura', 'Sophia Williams', 'Mason Garcia', 'Isabella Jones', 'Lucas Brown',
  'Mia Anderson', 'Oliver Davis', 'Charlotte Wilson', 'Elijah Martinez', 'Amelia Taylor',
  'James Moore', 'Harper Jackson', 'Benjamin White', 'Evelyn Harris', 'Alexander Clark',
  'Abigail Lewis', 'William Robinson', 'Emily Walker', 'Henry Young', 'Elizabeth Hall',
  'Sebastian Allen', 'Sofia King', 'Jack Wright', 'Avery Scott', 'Daniel Green'
];

// Register custom tooltip positioner that keeps tooltip at fixed vertical position
Chart.Tooltip.positioners.fixedTop = function(elements, eventPosition) {
  if (!elements.length) return false;
  const chart = elements[0].element.$context.chart;
  return {
    x: eventPosition.x,
    y: chart.chartArea.top
  };
};

// Plugin to draw vertical highlight band behind hovered bar
const hoverHighlightPlugin = {
  id: 'hoverHighlight',
  beforeDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) return;

    const { ctx, chartArea } = chart;
    const element = active[0].element;
    const barWidth = element.width;
    const x = element.x - barWidth / 2 - 4;
    const width = barWidth + 8;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x, chartArea.top, width, chartArea.bottom - chartArea.top);
    ctx.restore();
  }
};

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
const convoStarterEl = document.getElementById('convo-starter');
const responseTimeEl = document.getElementById('response-time');
const statTotalDetail = document.getElementById('stat-total-detail');
const statSentDetail = document.getElementById('stat-sent-detail');
const statReceivedDetail = document.getElementById('stat-received-detail');
const heatmapCanvas = document.getElementById('heatmap');
const heatmapTooltip = document.getElementById('heatmap-tooltip');
const heatmapLabel = document.getElementById('heatmap-label');
const everyoneTab = document.getElementById('everyone-tab');
const everyoneTotal = document.getElementById('everyone-total');
const yearFilterSection = document.getElementById('year-filter-section');
const yearFilterGrid = document.getElementById('year-filter');
const topContactsSection = document.getElementById('top-contacts-section');
const topContactsYear = document.getElementById('top-contacts-year');
const topContactsGrid = document.getElementById('top-contacts');
const busiestMonthSection = document.getElementById('busiest-month-section');
const busiestMonthEl = document.getElementById('busiest-month');
const patternsSection = document.querySelector('.patterns');
const chartToggle = document.querySelector('.chart-section .toggle');

// Heatmap state for hover
let currentHeatmapData = null;
const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatHour(hour) {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

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
    c.sidebar !== false && c.name.toLowerCase().includes(filter.toLowerCase())
  );

  contactList.innerHTML = filtered.map(c => `
    <li data-filename="${c.filename}" data-name="${c.name}"
        data-total="${c.total}" data-sent="${c.sent}" data-received="${c.received}"
        data-first="${c.first_date || ''}">
      <div class="contact-name">${c.name}</div>
      <div class="contact-meta">${formatNumber(c.total)} messages</div>
    </li>
  `).join('');
}

// Format date as "Feb 2016"
function formatSinceDate(dateStr) {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const date = new Date(year, month - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Load and display data for a contact
async function loadContact(filename, name, total, sent, received, firstDate) {
  isEveryoneView = false;

  // Update URL hash for persistence
  if (isNavigatingFromPopState) {
    isNavigatingFromPopState = false;
  } else {
    history.pushState(null, '', `#${filename}`);
  }

  // Update active state
  everyoneTab.classList.remove('active');
  document.querySelectorAll('#contact-list li').forEach(li => {
    li.classList.toggle('active', li.dataset.filename === filename);
  });

  // Hide Everyone-specific elements, show contact-specific
  yearFilterSection.style.display = 'none';
  topContactsSection.style.display = 'none';
  busiestMonthSection.style.display = 'none';
  patternsSection.style.display = 'block';
  chartToggle.style.display = 'flex';

  // Update header and extract first name
  contactNameEl.textContent = name;
  currentFirstName = name.split(' ')[0];

  // Update "texting since"
  const sinceEl = document.getElementById('texting-since');
  if (firstDate) {
    sinceEl.textContent = `Texting since ${formatSinceDate(firstDate)}`;
  } else {
    sinceEl.textContent = '';
  }

  // Show header and chart container
  welcome.style.display = 'none';
  document.getElementById('contact-header').style.display = 'block';
  chartContainer.style.display = 'block';

  // Update stats section
  statTotal.innerHTML = `<span class="num">${formatNumber(total)}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(received)}</span> received`;

  // Fetch contact data
  try {
    const response = await fetch(`data/messages/${filename}.json`);
    currentContactData = await response.json();
    renderChart();
    renderPatterns(currentContactData);
    renderAttachmentDetails(currentContactData.attachments);
    renderHeatmap(currentContactData.time_heatmap);
  } catch (err) {
    console.error('Failed to load contact data:', err);
  }
}

// Format seconds as human-readable time
function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

// Render conversation patterns
function renderPatterns(data) {
  const stats = data.response_stats || {};
  const name = currentFirstName;

  // Conversation starter
  if (stats.you_start_pct !== null && stats.you_start_pct !== undefined) {
    const youPct = Math.round(stats.you_start_pct * 100);
    const themPct = 100 - youPct;
    if (youPct > themPct) {
      convoStarterEl.innerHTML = `<span class="you">You</span> start the conversation ${youPct}% of the time`;
    } else if (themPct > youPct) {
      convoStarterEl.innerHTML = `<span class="them">${name}</span> starts the conversation ${themPct}% of the time`;
    } else {
      convoStarterEl.textContent = 'You both start conversations equally';
    }
  } else {
    convoStarterEl.textContent = '';
  }

  // Response times
  const youTime = formatTime(stats.you_avg_seconds);
  const themTime = formatTime(stats.them_avg_seconds);

  if (youTime && themTime) {
    responseTimeEl.innerHTML = `<span class="them">${name}</span> responds in about ${themTime}, <span class="you">you</span> respond in about ${youTime}`;
  } else if (youTime) {
    responseTimeEl.innerHTML = `<span class="you">You</span> respond in about ${youTime}`;
  } else if (themTime) {
    responseTimeEl.innerHTML = `<span class="them">${name}</span> responds in about ${themTime}`;
  } else {
    responseTimeEl.textContent = '';
  }
}

// Render attachment details under sent/received stats
function renderAttachmentDetails(att) {
  if (!att) {
    statTotalDetail.innerHTML = '';
    statSentDetail.innerHTML = '';
    statReceivedDetail.innerHTML = '';
    return;
  }

  // Use \u00A0 (non-breaking space) to keep number and unit together
  const nbsp = '\u00A0';

  // Build total details
  const totalParts = [];
  const totalPhotos = (att.photos_sent || 0) + (att.photos_received || 0);
  const totalVideos = (att.videos_sent || 0) + (att.videos_received || 0);
  const totalAudio = (att.audio_sent || 0) + (att.audio_received || 0);
  const totalGifs = (att.gifs_sent || 0) + (att.gifs_received || 0);
  if (totalPhotos) totalParts.push(`${formatNumber(totalPhotos)}${nbsp}photo${totalPhotos === 1 ? '' : 's'}`);
  if (totalVideos) totalParts.push(`${formatNumber(totalVideos)}${nbsp}video${totalVideos === 1 ? '' : 's'}`);
  if (totalAudio) totalParts.push(`${formatNumber(totalAudio)}${nbsp}audio`);
  if (totalGifs) totalParts.push(`${formatNumber(totalGifs)}${nbsp}GIF${totalGifs === 1 ? '' : 's'}`);
  statTotalDetail.innerHTML = totalParts.map((p, i) =>
    `<span class="detail-line">${i === 0 ? '└── ' : '    '}${p}</span>`
  ).join('');

  // Build sent details
  const sentParts = [];
  if (att.photos_sent) sentParts.push(`${formatNumber(att.photos_sent)}${nbsp}photo${att.photos_sent === 1 ? '' : 's'}`);
  if (att.videos_sent) sentParts.push(`${formatNumber(att.videos_sent)}${nbsp}video${att.videos_sent === 1 ? '' : 's'}`);
  if (att.audio_sent) sentParts.push(`${formatNumber(att.audio_sent)}${nbsp}audio`);
  if (att.gifs_sent) sentParts.push(`${formatNumber(att.gifs_sent)}${nbsp}GIF${att.gifs_sent === 1 ? '' : 's'}`);
  statSentDetail.innerHTML = sentParts.map((p, i) =>
    `<span class="detail-line">${i === 0 ? '└── ' : '    '}${p}</span>`
  ).join('');

  // Build received details
  const recvParts = [];
  if (att.photos_received) recvParts.push(`${formatNumber(att.photos_received)}${nbsp}photo${att.photos_received === 1 ? '' : 's'}`);
  if (att.videos_received) recvParts.push(`${formatNumber(att.videos_received)}${nbsp}video${att.videos_received === 1 ? '' : 's'}`);
  if (att.audio_received) recvParts.push(`${formatNumber(att.audio_received)}${nbsp}audio`);
  if (att.gifs_received) recvParts.push(`${formatNumber(att.gifs_received)}${nbsp}GIF${att.gifs_received === 1 ? '' : 's'}`);
  statReceivedDetail.innerHTML = recvParts.map((p, i) =>
    `<span class="detail-line">${i === 0 ? '└── ' : '    '}${p}</span>`
  ).join('');
}

// Get time-of-day period for an hour
function getTimePeriod(hour) {
  if (hour >= 5 && hour < 12) return 'mornings';
  if (hour >= 12 && hour < 17) return 'afternoons';
  if (hour >= 17 && hour < 21) return 'evenings';
  return 'nights'; // 21-23, 0-4
}

// Render time heatmap
function renderHeatmap(heatmap) {
  if (!heatmap || !heatmapCanvas) return;

  currentHeatmapData = heatmap;

  const ctx = heatmapCanvas.getContext('2d');
  const rect = heatmapCanvas.getBoundingClientRect();

  // Set canvas size for retina
  const dpr = window.devicePixelRatio || 1;
  heatmapCanvas.width = rect.width * dpr;
  heatmapCanvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const cellWidth = width / 24;
  const cellHeight = height / 7;

  // Find max value for normalization and aggregate by day + time period
  let max = 0;
  const periodTotals = {}; // "day-period" -> count

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const val = heatmap[day]?.[hour] || 0;
      if (val > max) max = val;

      const period = getTimePeriod(hour);
      const key = `${day}-${period}`;
      periodTotals[key] = (periodTotals[key] || 0) + val;
    }
  }

  // Find peak day + period combination
  let peakKey = null;
  let peakCount = 0;
  for (const [key, count] of Object.entries(periodTotals)) {
    if (count > peakCount) {
      peakCount = count;
      peakKey = key;
    }
  }

  // Display peak time label
  if (peakKey && peakCount > 0) {
    const [dayIdx, period] = peakKey.split('-');
    const dayName = dayNames[parseInt(dayIdx)];
    heatmapLabel.textContent = `You usually text on ${dayName} ${period}`;
  } else {
    heatmapLabel.textContent = '';
  }

  // Draw cells
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const value = heatmap[day]?.[hour] || 0;
      const intensity = max > 0 ? value / max : 0;

      // Blue with varying opacity
      const alpha = 0.08 + intensity * 0.92;
      ctx.fillStyle = `rgba(56, 132, 255, ${alpha})`;

      const x = hour * cellWidth;
      const y = day * cellHeight;
      ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    }
  }
}

// Heatmap hover handlers
heatmapCanvas.addEventListener('mousemove', (e) => {
  if (!currentHeatmapData) return;

  const rect = heatmapCanvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const cellWidth = rect.width / 24;
  const cellHeight = rect.height / 7;

  const hour = Math.floor(x / cellWidth);
  const day = Math.floor(y / cellHeight);

  if (hour >= 0 && hour < 24 && day >= 0 && day < 7) {
    const count = currentHeatmapData[day]?.[hour] || 0;
    const dayName = dayNames[day];
    const timeRange = `${formatHour(hour)}-${formatHour(hour + 1)}`;

    heatmapTooltip.textContent = `${dayName} ${timeRange}: ${count} message${count === 1 ? '' : 's'}`;
    heatmapTooltip.classList.add('visible');

    // Measure tooltip size
    const tooltipRect = heatmapTooltip.getBoundingClientRect();
    const tooltipWidth = tooltipRect.width;
    const tooltipHeight = tooltipRect.height;

    // Position tooltip relative to cursor, keeping within viewport
    let left = e.clientX - rect.left + 10;
    let top = e.clientY - rect.top - tooltipHeight - 5;

    // Check right edge (use viewport, not just canvas)
    const rightEdge = e.clientX + tooltipWidth + 20;
    if (rightEdge > window.innerWidth) {
      left = e.clientX - rect.left - tooltipWidth - 10;
    }

    // Check top edge
    if (top < 0) {
      top = e.clientY - rect.top + 20;
    }

    heatmapTooltip.style.left = `${left}px`;
    heatmapTooltip.style.top = `${top}px`;
  }
});

heatmapCanvas.addEventListener('mouseleave', () => {
  heatmapTooltip.classList.remove('visible');
});

// Render the chart based on current view
function renderChart() {
  if (!currentContactData || !currentContactData.monthly) return;
  const currentMonthlyData = currentContactData.monthly;

  const ctx = document.getElementById('chart').getContext('2d');

  // Destroy existing chart
  if (chart) {
    chart.destroy();
  }

  let data, labels, tooltipFormat;

  // Track which indices are year starts (for styling)
  let yearStartIndices = new Set();

  if (currentView === 'year') {
    const yearly = aggregateToYearly(currentMonthlyData);
    data = yearly;
    labels = yearly.map(y => y.year);
    tooltipFormat = (item) => item.year;
  } else {
    data = currentMonthlyData;
    labels = currentMonthlyData.map((m, i) => {
      const [year, month] = m.month.split('-');
      const date = new Date(year, month - 1);
      // Show year on January or first item
      if (month === '01' || i === 0) {
        yearStartIndices.add(i);
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
    plugins: [hoverHighlightPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'sent',
          data: data.map(d => d.sent),
          backgroundColor: '#FFCC00',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
        {
          label: 'recv',
          data: data.map(d => d.received),
          backgroundColor: '#BF5AF2',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          position: 'fixedTop',
          yAlign: 'top',
          caretSize: 0,
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
            autoSkip: false,
            maxRotation: 45,
            minRotation: 45,
            callback: function(value, index) {
              // Hide all labels for single year on aggregate view
              if (isEveryoneView && currentYearFilter !== 'all') return null;

              // In year view, show all labels
              if (currentView === 'year') return this.getLabelForValue(value);

              // In month view, only show January with year
              if (yearStartIndices.has(index)) {
                return this.getLabelForValue(value);
              }

              return null;
            },
            color: '#999',
            font: {
              family: 'SF Mono, Monaco, monospace',
              size: 12,
              weight: 'bold'
            }
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

// Render year filter buttons
function renderYearFilter(years) {
  yearFilterGrid.innerHTML = '<button data-year="all" class="active">All time</button>' +
    years.map(y => `<button data-year="${y}">${y}</button>`).join('');
}

// Update active state on year filter buttons
function updateYearFilterActive(year) {
  yearFilterGrid.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.year === year);
  });
}

// Format month as "January 2024"
function formatMonthLong(monthStr) {
  const [year, month] = monthStr.split('-');
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });
}

// Render top contacts grid
function renderTopContacts(topContacts) {
  topContactsGrid.innerHTML = topContacts.map(c => `
    <div class="top-contact-card" data-filename="${c.filename}">
      <div class="top-contact-rank">#${c.rank}</div>
      <div class="top-contact-name">${c.name}</div>
      <div class="top-contact-count">${formatNumber(c.total)} messages</div>
    </div>
  `).join('');
}

// Load Everyone view
async function loadEveryone() {
  isEveryoneView = true;

  // Update URL hash (only push to history if not from popstate)
  const newHash = currentYearFilter === 'all' ? '#everyone' : `#everyone/${currentYearFilter}`;
  if (isNavigatingFromPopState) {
    isNavigatingFromPopState = false;
  } else {
    history.pushState(null, '', newHash);
  }

  // Update active states
  everyoneTab.classList.add('active');
  document.querySelectorAll('#contact-list li').forEach(li => {
    li.classList.remove('active');
  });

  // Show/hide appropriate sections
  welcome.style.display = 'none';
  document.getElementById('contact-header').style.display = 'block';
  chartContainer.style.display = 'block';
  yearFilterSection.style.display = 'block';
  patternsSection.style.display = 'none'; // No response stats for global

  // Fetch everyone data if not loaded
  if (!everyoneData) {
    try {
      const response = await fetch('data/everyone.json');
      everyoneData = await response.json();
      renderYearFilter(everyoneData.years);
      everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
    } catch (err) {
      console.error('Failed to load everyone data:', err);
      return;
    }
  }

  // Apply current year filter
  loadEveryoneYear(currentYearFilter);
}

// Load Everyone view for a specific year (does not modify history)
function loadEveryoneYear(year) {
  currentYearFilter = year;
  updateYearFilterActive(year);

  let data, sent, received, firstDate, monthly, heatmap;

  if (year === 'all') {
    sent = everyoneData.total_sent;
    received = everyoneData.total_received;
    firstDate = null; // Don't show "texting since" on aggregation view
    monthly = everyoneData.monthly;
    heatmap = everyoneData.time_heatmap;
    data = everyoneData;

    // Hide year-specific sections
    topContactsSection.style.display = 'none';
    busiestMonthSection.style.display = 'none';

    // Show month/year toggle for all-time view
    chartToggle.style.display = 'flex';
  } else {
    const yearData = everyoneData.by_year[year];
    if (!yearData) return;

    sent = yearData.sent;
    received = yearData.received;
    firstDate = null; // Don't show "texting since" for year filter
    monthly = yearData.monthly;
    heatmap = yearData.time_heatmap;
    data = yearData;

    // Show top contacts for this year
    if (yearData.top_contacts && yearData.top_contacts.length > 0) {
      // Apply fake names if in fake mode
      let displayContacts = yearData.top_contacts;
      if (FAKE_MODE) {
        displayContacts = yearData.top_contacts.map((c, i) => ({
          ...c,
          name: fakeNames[i] || c.name
        }));
      }
      topContactsYear.textContent = year;
      renderTopContacts(displayContacts);
      topContactsSection.style.display = 'block';
    } else {
      topContactsSection.style.display = 'none';
    }

    // Show busiest month
    if (yearData.busiest_month) {
      busiestMonthEl.innerHTML = `Your busiest month was <span>${formatMonthLong(yearData.busiest_month.month)}</span> with ${formatNumber(yearData.busiest_month.total)} messages`;
      busiestMonthSection.style.display = 'block';
    } else {
      busiestMonthSection.style.display = 'none';
    }

    // Hide month/year toggle for single year (only month view makes sense)
    chartToggle.style.display = 'none';
    // Reset to month view if currently on year view
    if (currentView === 'year') {
      currentView = 'month';
      toggleButtons.forEach(b => b.classList.toggle('active', b.dataset.view === 'month'));
    }
  }

  // Update header
  contactNameEl.textContent = 'iMessage Stats';
  const sinceEl = document.getElementById('texting-since');
  if (firstDate) {
    sinceEl.textContent = `Texting since ${formatSinceDate(firstDate)}`;
  } else {
    sinceEl.textContent = '';
  }

  // Update stats
  const total = sent + received;
  statTotal.innerHTML = `<span class="num">${formatNumber(total)}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(received)}</span> received`;

  // Update attachment details
  if (year === 'all') {
    renderAttachmentDetails(everyoneData.attachments);
  } else {
    renderAttachmentDetails(everyoneData.by_year[year].attachments);
  }

  // Update chart and heatmap
  currentContactData = { monthly };
  renderChart();
  renderHeatmap(heatmap);
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
      parseInt(li.dataset.received),
      li.dataset.first
    );
  }
});

searchInput.addEventListener('input', (e) => {
  renderContacts(e.target.value);
});

// Everyone tab click
everyoneTab.addEventListener('click', () => {
  currentYearFilter = 'all';
  loadEveryone();
});

// Year filter button click
yearFilterGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (btn) {
    const year = btn.dataset.year;
    const newHash = year === 'all' ? '#everyone' : `#everyone/${year}`;
    history.pushState(null, '', newHash);
    loadEveryoneYear(year);
  }
});

// Top contacts card click
topContactsGrid.addEventListener('click', (e) => {
  const card = e.target.closest('.top-contact-card');
  if (card) {
    const filename = card.dataset.filename;
    const contact = contacts.find(c => c.filename === filename);
    if (contact) {
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date);
    }
  }
});

// Keyboard navigation for contacts list (includes Everyone tab)
document.addEventListener('keydown', (e) => {
  // Skip if typing in search
  if (document.activeElement === searchInput && searchInput.value) return;

  // Left/right arrows for year filter navigation on aggregate view
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isEveryoneView && everyoneData) {
    e.preventDefault();

    // Build year options array: ['all', '2026', '2025', ...]
    const yearOptions = ['all', ...everyoneData.years];
    let currentIndex = yearOptions.indexOf(currentYearFilter);
    if (currentIndex === -1) currentIndex = 0;

    if (e.key === 'ArrowLeft') {
      currentIndex = currentIndex > 0 ? currentIndex - 1 : yearOptions.length - 1;
    } else {
      currentIndex = currentIndex < yearOptions.length - 1 ? currentIndex + 1 : 0;
    }

    const newYear = yearOptions[currentIndex];
    const newHash = newYear === 'all' ? '#everyone' : `#everyone/${newYear}`;
    history.pushState(null, '', newHash);
    loadEveryoneYear(newYear);

    // Focus the newly active button
    const activeBtn = yearFilterGrid.querySelector('button.active');
    if (activeBtn) activeBtn.focus();
    return;
  }

  // Up/down arrows for contact navigation
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;

  e.preventDefault();

  const items = Array.from(contactList.querySelectorAll('li'));
  // Index -1 = Everyone, 0+ = contacts
  let currentIndex = isEveryoneView ? -1 : items.findIndex(li => li.classList.contains('active'));

  if (e.key === 'ArrowDown') {
    if (currentIndex < items.length - 1) {
      currentIndex++;
    } else {
      currentIndex = -1; // Wrap to Everyone
    }
  } else if (e.key === 'ArrowUp') {
    if (currentIndex > -1) {
      currentIndex--;
    } else {
      currentIndex = items.length - 1; // Wrap to last contact
    }
  }

  if (currentIndex === -1) {
    // Select Everyone
    currentYearFilter = 'all';
    loadEveryone();
  } else {
    const targetItem = items[currentIndex];
    if (targetItem) {
      targetItem.scrollIntoView({ block: 'nearest' });
      loadContact(
        targetItem.dataset.filename,
        targetItem.dataset.name,
        parseInt(targetItem.dataset.total),
        parseInt(targetItem.dataset.sent),
        parseInt(targetItem.dataset.received),
        targetItem.dataset.first
      );
    }
  }
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

// Handle browser back/forward navigation
window.addEventListener('popstate', () => {
  const hash = window.location.hash.slice(1);
  isNavigatingFromPopState = true;

  if (hash === 'everyone' || hash === '') {
    currentYearFilter = 'all';
    loadEveryone();
  } else if (hash.startsWith('everyone/')) {
    const year = hash.split('/')[1];
    if (everyoneData && everyoneData.years.includes(year)) {
      currentYearFilter = year;
    } else {
      currentYearFilter = 'all';
    }
    loadEveryone();
  } else {
    // Contact view
    const contact = contacts.find(c => c.filename === hash);
    if (contact) {
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date);
    } else {
      currentYearFilter = 'all';
      loadEveryone();
    }
  }
});

// Initialize
async function init() {
  try {
    // Load contacts and everyone data in parallel
    const [contactsResponse, everyoneResponse] = await Promise.all([
      fetch('data/contacts.json'),
      fetch('data/everyone.json')
    ]);

    contacts = await contactsResponse.json();
    everyoneData = await everyoneResponse.json();

    // Apply fake names for screenshots
    if (FAKE_MODE) {
      contacts.forEach((c, i) => {
        if (fakeNames[i]) c.name = fakeNames[i];
      });
    }

    renderContacts();

    // Update Everyone tab with total
    everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
    renderYearFilter(everyoneData.years);

    // Restore selection from URL hash (don't push to history on initial load)
    const hash = window.location.hash.slice(1);
    isNavigatingFromPopState = true;

    if (hash === 'everyone' || hash === '') {
      // Default to Everyone view
      loadEveryone();
    } else if (hash.startsWith('everyone/')) {
      // Everyone view with year filter
      const year = hash.split('/')[1];
      if (everyoneData.years.includes(year)) {
        currentYearFilter = year;
      }
      loadEveryone();
    } else {
      // Contact view
      const contact = contacts.find(c => c.filename === hash);
      if (contact) {
        loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date);
        // Scroll the contact into view in the sidebar
        const activeItem = contactList.querySelector('li.active');
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest' });
        }
      } else {
        // Invalid hash, default to Everyone
        loadEveryone();
      }
    }
  } catch (err) {
    console.error('Failed to load data:', err);
    contactList.innerHTML = '<li>run ./scripts/start first</li>';
  }
}

init();
