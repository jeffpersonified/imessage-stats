// State
let contacts = [];
let chart = null;
let currentContactData = null;
let currentView = 'month';
let currentFirstName = '';

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
const heatmapPeak = document.getElementById('heatmap-peak');

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
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  contactList.innerHTML = filtered.map(c => `
    <li data-filename="${c.filename}" data-name="${c.name}"
        data-total="${c.total}" data-sent="${c.sent}" data-received="${c.received}"
        data-first="${c.first_date || ''}">
      <div class="contact-name">${c.name}</div>
      <div class="contact-meta">${formatNumber(c.total)}</div>
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
  // Update URL hash for persistence
  history.replaceState(null, '', `#${filename}`);

  // Update active state
  document.querySelectorAll('#contact-list li').forEach(li => {
    li.classList.toggle('active', li.dataset.filename === filename);
  });

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
    statTotalDetail.textContent = '';
    statSentDetail.textContent = '';
    statReceivedDetail.textContent = '';
    return;
  }

  // Build total details
  const totalParts = [];
  const totalPhotos = (att.photos_sent || 0) + (att.photos_received || 0);
  const totalVideos = (att.videos_sent || 0) + (att.videos_received || 0);
  const totalAudio = (att.audio_sent || 0) + (att.audio_received || 0);
  const totalGifs = (att.gifs_sent || 0) + (att.gifs_received || 0);
  if (totalPhotos) totalParts.push(`${formatNumber(totalPhotos)} photo${totalPhotos === 1 ? '' : 's'}`);
  if (totalVideos) totalParts.push(`${formatNumber(totalVideos)} video${totalVideos === 1 ? '' : 's'}`);
  if (totalAudio) totalParts.push(`${formatNumber(totalAudio)} audio`);
  if (totalGifs) totalParts.push(`${formatNumber(totalGifs)} GIF${totalGifs === 1 ? '' : 's'}`);
  statTotalDetail.textContent = totalParts.length ? totalParts.join(', ') : '';

  // Build sent details
  const sentParts = [];
  if (att.photos_sent) sentParts.push(`${formatNumber(att.photos_sent)} photo${att.photos_sent === 1 ? '' : 's'}`);
  if (att.videos_sent) sentParts.push(`${formatNumber(att.videos_sent)} video${att.videos_sent === 1 ? '' : 's'}`);
  if (att.audio_sent) sentParts.push(`${formatNumber(att.audio_sent)} audio`);
  if (att.gifs_sent) sentParts.push(`${formatNumber(att.gifs_sent)} GIF${att.gifs_sent === 1 ? '' : 's'}`);
  statSentDetail.textContent = sentParts.length ? sentParts.join(', ') : '';

  // Build received details
  const recvParts = [];
  if (att.photos_received) recvParts.push(`${formatNumber(att.photos_received)} photo${att.photos_received === 1 ? '' : 's'}`);
  if (att.videos_received) recvParts.push(`${formatNumber(att.videos_received)} video${att.videos_received === 1 ? '' : 's'}`);
  if (att.audio_received) recvParts.push(`${formatNumber(att.audio_received)} audio`);
  if (att.gifs_received) recvParts.push(`${formatNumber(att.gifs_received)} GIF${att.gifs_received === 1 ? '' : 's'}`);
  statReceivedDetail.textContent = recvParts.length ? recvParts.join(', ') : '';
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

  // Display peak time
  if (peakKey && peakCount > 0) {
    const [dayIdx, period] = peakKey.split('-');
    const dayName = dayNames[parseInt(dayIdx)];
    heatmapPeak.textContent = `${dayName} ${period}`;
  } else {
    heatmapPeak.textContent = '';
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

    // Position tooltip
    let left = e.clientX - rect.left + 10;
    let top = e.clientY - rect.top - 30;

    // Keep tooltip in bounds
    if (left + 150 > rect.width) left = e.clientX - rect.left - 160;
    if (top < 0) top = e.clientY - rect.top + 20;

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
      parseInt(li.dataset.received),
      li.dataset.first
    );
  }
});

searchInput.addEventListener('input', (e) => {
  renderContacts(e.target.value);
});

// Keyboard navigation for contacts list
document.addEventListener('keydown', (e) => {
  // Only handle arrow keys when not typing in search
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (document.activeElement === searchInput && searchInput.value) return;

  e.preventDefault();

  const items = Array.from(contactList.querySelectorAll('li'));
  if (items.length === 0) return;

  const activeItem = contactList.querySelector('li.active');
  let currentIndex = activeItem ? items.indexOf(activeItem) : -1;

  if (e.key === 'ArrowDown') {
    currentIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
  } else if (e.key === 'ArrowUp') {
    currentIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
  }

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

    // Restore selection from URL hash
    const hash = window.location.hash.slice(1);
    if (hash) {
      const contact = contacts.find(c => c.filename === hash);
      if (contact) {
        loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date);
        // Scroll the contact into view in the sidebar
        const activeItem = contactList.querySelector('li.active');
        if (activeItem) {
          activeItem.scrollIntoView({ block: 'nearest' });
        }
      }
    }
  } catch (err) {
    console.error('Failed to load contacts:', err);
    contactList.innerHTML = '<li>run ./scripts/start first</li>';
  }
}

init();
