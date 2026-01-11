import './style.css';
import { Chart, registerables, Tooltip, ChartType, TooltipPositionerFunction, Plugin, BarElement } from 'chart.js';
import type { ContactSummary, ContactData, ExportProgress, EveryoneData, TopContact } from '../../src/exporter/types';

// Register Chart.js components
Chart.register(...registerables);

// Declare the tooltip positioner
declare module 'chart.js' {
  interface TooltipPositionerMap {
    fixedTop: TooltipPositionerFunction<ChartType>;
  }
}

// Register custom tooltip positioner
Tooltip.positioners.fixedTop = function (elements, eventPosition) {
  if (!elements.length) return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chart = (elements[0].element as any).$context.chart;
  return {
    x: eventPosition.x,
    y: chart.chartArea.top,
  };
};

// Plugin to draw vertical highlight band
const hoverHighlightPlugin: Plugin<'bar'> = {
  id: 'hoverHighlight',
  beforeDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) return;

    const { ctx, chartArea } = chart;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const element = active[0].element as any;
    const barWidth = element.width || 20;
    const x = element.x - barWidth / 2 - 4;
    const width = barWidth + 8;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x, chartArea.top, width, chartArea.bottom - chartArea.top);
    ctx.restore();
  },
};

// State
let contacts: ContactSummary[] = [];
let chart: Chart | null = null;
let currentContactData: ContactData | null = null;
let currentView: 'month' | 'year' = 'month';
let currentFirstName = '';
let currentHeatmapData: number[][] | null = null;
let everyoneData: EveryoneData | null = null;
let currentYearFilter = 'all';
let isEveryoneView = false;
let isNavigatingFromPopState = false;

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// DOM Elements
const onboarding = document.getElementById('onboarding') as HTMLDivElement;
const openSettingsBtn = document.getElementById('open-settings') as HTMLButtonElement;
const loading = document.getElementById('loading') as HTMLDivElement;
const loadingMessage = document.getElementById('loading-message') as HTMLParagraphElement;
const loadingProgress = document.getElementById('loading-progress') as HTMLDivElement;
const contactList = document.getElementById('contact-list') as HTMLUListElement;
const searchInput = document.getElementById('search') as HTMLInputElement;
const welcome = document.getElementById('welcome') as HTMLDivElement;
const chartContainer = document.getElementById('chart-container') as HTMLDivElement;
const contactHeader = document.getElementById('contact-header') as HTMLElement;
const contactNameEl = document.getElementById('contact-name') as HTMLHeadingElement;
const textingSince = document.getElementById('texting-since') as HTMLSpanElement;
const statTotal = document.getElementById('stat-total') as HTMLParagraphElement;
const statSent = document.getElementById('stat-sent') as HTMLParagraphElement;
const statReceived = document.getElementById('stat-received') as HTMLParagraphElement;
const statTotalDetail = document.getElementById('stat-total-detail') as HTMLParagraphElement;
const statSentDetail = document.getElementById('stat-sent-detail') as HTMLParagraphElement;
const statReceivedDetail = document.getElementById('stat-received-detail') as HTMLParagraphElement;
const convoStarterEl = document.getElementById('convo-starter') as HTMLParagraphElement;
const responseTimeEl = document.getElementById('response-time') as HTMLParagraphElement;
const heatmapCanvas = document.getElementById('heatmap') as HTMLCanvasElement;
const heatmapTooltip = document.getElementById('heatmap-tooltip') as HTMLDivElement;
const heatmapLabel = document.getElementById('heatmap-label') as HTMLParagraphElement;
const toggleButtons = document.querySelectorAll('.toggle button');

// Everyone view elements
const everyoneTab = document.getElementById('everyone-tab') as HTMLDivElement;
const everyoneTotal = document.getElementById('everyone-total') as HTMLDivElement;
const yearFilterSection = document.getElementById('year-filter-section') as HTMLElement;
const yearFilterGrid = document.getElementById('year-filter') as HTMLDivElement;
const topContactsSection = document.getElementById('top-contacts-section') as HTMLElement;
const topContactsYear = document.getElementById('top-contacts-year') as HTMLSpanElement;
const topContactsGrid = document.getElementById('top-contacts') as HTMLDivElement;
const busiestMonthSection = document.getElementById('busiest-month-section') as HTMLElement;
const busiestMonthEl = document.getElementById('busiest-month') as HTMLParagraphElement;
const patternsSection = document.querySelector('.patterns') as HTMLElement;
const chartToggle = document.querySelector('.chart-section .toggle') as HTMLDivElement;

// Utility functions
function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatHour(hour: number): string {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
}

function formatSinceDate(dateStr: string): string {
  if (!dateStr) return '';
  const [year, month] = dateStr.split('-');
  const date = new Date(parseInt(year), parseInt(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function formatTime(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins} minute${mins === 1 ? '' : 's'}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function getTimePeriod(hour: number): string {
  if (hour >= 5 && hour < 12) return 'mornings';
  if (hour >= 12 && hour < 17) return 'afternoons';
  if (hour >= 17 && hour < 21) return 'evenings';
  return 'nights';
}

// Show/hide overlays
function showOnboarding() {
  onboarding.style.display = 'flex';
  loading.style.display = 'none';
}

function hideOnboarding() {
  onboarding.style.display = 'none';
}

function showLoading(message: string, progress = 0) {
  loading.style.display = 'flex';
  loadingMessage.textContent = message;
  loadingProgress.style.width = `${progress}%`;
}

function hideLoading() {
  loading.style.display = 'none';
}

function updateLoadingProgress(progress: ExportProgress) {
  const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
  loadingMessage.textContent = progress.message;
  loadingProgress.style.width = `${percent}%`;
}

// Render contact list
function renderContacts(filter = '') {
  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(filter.toLowerCase())
  );

  contactList.innerHTML = filtered
    .map(
      (c) => `
    <li data-filename="${c.filename}" data-name="${c.name}"
        data-total="${c.total}" data-sent="${c.sent}" data-received="${c.received}"
        data-first="${c.first_date || ''}">
      <div class="contact-name">${c.name}</div>
      <div class="contact-meta">${formatNumber(c.total)}</div>
    </li>
  `
    )
    .join('');
}

// Load and display contact data
async function loadContact(
  filename: string,
  name: string,
  total: number,
  sent: number,
  received: number,
  firstDate: string
) {
  isEveryoneView = false;

  // Update URL hash
  if (isNavigatingFromPopState) {
    isNavigatingFromPopState = false;
  } else {
    history.pushState(null, '', `#${filename}`);
  }

  // Update active state
  everyoneTab.classList.remove('active');
  document.querySelectorAll('#contact-list li').forEach((li) => {
    li.classList.toggle('active', (li as HTMLLIElement).dataset.filename === filename);
  });

  // Hide Everyone-specific elements, show contact-specific
  yearFilterSection.style.display = 'none';
  topContactsSection.style.display = 'none';
  busiestMonthSection.style.display = 'none';
  patternsSection.style.display = 'block';
  chartToggle.style.display = 'flex';

  // Update header
  contactNameEl.textContent = name;
  currentFirstName = name.split(' ')[0];
  textingSince.textContent = firstDate ? `Texting since ${formatSinceDate(firstDate)}` : '';

  // Show content
  welcome.style.display = 'none';
  contactHeader.style.display = 'block';
  chartContainer.style.display = 'block';

  // Update stats
  statTotal.innerHTML = `<span class="num">${formatNumber(total)}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(received)}</span> received`;

  // Fetch contact data via IPC
  try {
    const data = await window.electronAPI.contacts.get(filename);
    if (data) {
      currentContactData = data;
      renderChart();
      renderPatterns(data);
      renderAttachmentDetails(data.attachments);
      renderHeatmap(data.time_heatmap);
    }
  } catch (err) {
    console.error('Failed to load contact data:', err);
  }
}

// Render patterns section
function renderPatterns(data: ContactData) {
  const stats = data.response_stats || {};
  const name = currentFirstName;

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

// Render attachment details
function renderAttachmentDetails(att: ContactData['attachments']) {
  if (!att) {
    statTotalDetail.innerHTML = '';
    statSentDetail.innerHTML = '';
    statReceivedDetail.innerHTML = '';
    return;
  }

  const nbsp = '\u00A0';

  const totalParts: string[] = [];
  const totalPhotos = (att.photos_sent || 0) + (att.photos_received || 0);
  const totalVideos = (att.videos_sent || 0) + (att.videos_received || 0);
  const totalAudio = (att.audio_sent || 0) + (att.audio_received || 0);
  const totalGifs = (att.gifs_sent || 0) + (att.gifs_received || 0);

  if (totalPhotos) totalParts.push(`${formatNumber(totalPhotos)}${nbsp}photo${totalPhotos === 1 ? '' : 's'}`);
  if (totalVideos) totalParts.push(`${formatNumber(totalVideos)}${nbsp}video${totalVideos === 1 ? '' : 's'}`);
  if (totalAudio) totalParts.push(`${formatNumber(totalAudio)}${nbsp}audio`);
  if (totalGifs) totalParts.push(`${formatNumber(totalGifs)}${nbsp}GIF${totalGifs === 1 ? '' : 's'}`);

  statTotalDetail.innerHTML = totalParts
    .map((p, i) => `<span class="detail-line">${i === 0 ? '\u2514\u2500\u2500 ' : '    '}${p}</span>`)
    .join('');

  const sentParts: string[] = [];
  if (att.photos_sent) sentParts.push(`${formatNumber(att.photos_sent)}${nbsp}photo${att.photos_sent === 1 ? '' : 's'}`);
  if (att.videos_sent) sentParts.push(`${formatNumber(att.videos_sent)}${nbsp}video${att.videos_sent === 1 ? '' : 's'}`);
  if (att.audio_sent) sentParts.push(`${formatNumber(att.audio_sent)}${nbsp}audio`);
  if (att.gifs_sent) sentParts.push(`${formatNumber(att.gifs_sent)}${nbsp}GIF${att.gifs_sent === 1 ? '' : 's'}`);

  statSentDetail.innerHTML = sentParts
    .map((p, i) => `<span class="detail-line">${i === 0 ? '\u2514\u2500\u2500 ' : '    '}${p}</span>`)
    .join('');

  const recvParts: string[] = [];
  if (att.photos_received) recvParts.push(`${formatNumber(att.photos_received)}${nbsp}photo${att.photos_received === 1 ? '' : 's'}`);
  if (att.videos_received) recvParts.push(`${formatNumber(att.videos_received)}${nbsp}video${att.videos_received === 1 ? '' : 's'}`);
  if (att.audio_received) recvParts.push(`${formatNumber(att.audio_received)}${nbsp}audio`);
  if (att.gifs_received) recvParts.push(`${formatNumber(att.gifs_received)}${nbsp}GIF${att.gifs_received === 1 ? '' : 's'}`);

  statReceivedDetail.innerHTML = recvParts
    .map((p, i) => `<span class="detail-line">${i === 0 ? '\u2514\u2500\u2500 ' : '    '}${p}</span>`)
    .join('');
}

// Render heatmap
function renderHeatmap(heatmap: number[][]) {
  if (!heatmap || !heatmapCanvas) return;

  currentHeatmapData = heatmap;

  const ctx = heatmapCanvas.getContext('2d');
  if (!ctx) return;

  const rect = heatmapCanvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  heatmapCanvas.width = rect.width * dpr;
  heatmapCanvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const width = rect.width;
  const height = rect.height;
  const cellWidth = width / 24;
  const cellHeight = height / 7;

  let max = 0;
  const periodTotals: Record<string, number> = {};

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const val = heatmap[day]?.[hour] || 0;
      if (val > max) max = val;

      const period = getTimePeriod(hour);
      const key = `${day}-${period}`;
      periodTotals[key] = (periodTotals[key] || 0) + val;
    }
  }

  let peakKey: string | null = null;
  let peakCount = 0;
  for (const [key, count] of Object.entries(periodTotals)) {
    if (count > peakCount) {
      peakCount = count;
      peakKey = key;
    }
  }

  if (peakKey && peakCount > 0) {
    const [dayIdx, period] = peakKey.split('-');
    const dayName = dayNames[parseInt(dayIdx)];
    heatmapLabel.textContent = `You usually text on ${dayName} ${period}`;
  } else {
    heatmapLabel.textContent = '';
  }

  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const value = heatmap[day]?.[hour] || 0;
      const intensity = max > 0 ? value / max : 0;
      const alpha = 0.08 + intensity * 0.92;
      ctx.fillStyle = `rgba(56, 132, 255, ${alpha})`;

      const x = hour * cellWidth;
      const y = day * cellHeight;
      ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    }
  }
}

// Aggregate monthly to yearly
function aggregateToYearly(monthly: { month: string; sent: number; received: number }[]) {
  const yearly: Record<string, { year: string; sent: number; received: number }> = {};
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

// Render chart
function renderChart() {
  if (!currentContactData?.monthly) return;

  const ctx = (document.getElementById('chart') as HTMLCanvasElement).getContext('2d');
  if (!ctx) return;

  if (chart) {
    chart.destroy();
  }

  let data: Array<{ month?: string; year?: string; sent: number; received: number }>;
  let labels: string[];
  let tooltipFormat: (item: { month?: string; year?: string }) => string;
  const yearStartIndices = new Set<number>();

  if (currentView === 'year') {
    const yearly = aggregateToYearly(currentContactData.monthly);
    data = yearly;
    labels = yearly.map((y) => y.year);
    tooltipFormat = (item) => item.year || '';
  } else {
    data = currentContactData.monthly;
    labels = currentContactData.monthly.map((m, i) => {
      const [year, month] = m.month.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1);
      if (month === '01' || i === 0) {
        yearStartIndices.add(i);
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
      }
      return date.toLocaleDateString('en-US', { month: 'short' });
    });
    tooltipFormat = (item) => {
      const [year, month] = (item.month || '').split('-');
      return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
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
          data: data.map((d) => d.sent),
          backgroundColor: '#FFCC00',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
        {
          label: 'recv',
          data: data.map((d) => d.received),
          backgroundColor: '#BF5AF2',
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: 'index',
      },
      plugins: {
        legend: { display: false },
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
            title: (items) => tooltipFormat(data[items[0].dataIndex]),
            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw as number)}`,
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const total = data[idx].sent + data[idx].received;
              return `\n total: ${formatNumber(total)}`;
            },
          },
        },
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
            callback: function (value, index) {
              // Hide all labels for single year on aggregate view
              if (isEveryoneView && currentYearFilter !== 'all') return null;

              if (currentView === 'year') return this.getLabelForValue(value as number);
              if (yearStartIndices.has(index)) return this.getLabelForValue(value as number);
              return null;
            },
            color: '#999',
            font: { family: 'SF Mono, Monaco, monospace', size: 12, weight: 'bold' },
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: '#1a1a1a' },
          border: { display: false },
          ticks: {
            color: '#555',
            font: { family: 'SF Mono, Monaco, monospace', size: 10 },
            callback: (v) => formatNumber(v as number),
          },
        },
      },
    },
  });
}

// Render year filter buttons
function renderYearFilter(years: string[]) {
  yearFilterGrid.innerHTML = '<button data-year="all" class="active">All time</button>' +
    years.map(y => `<button data-year="${y}">${y}</button>`).join('');
}

// Update active state on year filter buttons
function updateYearFilterActive(year: string) {
  yearFilterGrid.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', (btn as HTMLButtonElement).dataset.year === year);
  });
}

// Format month as "January 2024"
function formatMonthLong(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });
}

// Render top contacts grid
function renderTopContacts(topContacts: TopContact[]) {
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

  // Update URL hash
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
  contactHeader.style.display = 'block';
  chartContainer.style.display = 'block';
  yearFilterSection.style.display = 'block';
  patternsSection.style.display = 'none';

  // Fetch everyone data if not loaded
  if (!everyoneData) {
    try {
      everyoneData = await window.electronAPI.everyone.get();
      if (everyoneData) {
        renderYearFilter(everyoneData.years);
        everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
      }
    } catch (err) {
      console.error('Failed to load everyone data:', err);
      return;
    }
  }

  // Apply current year filter
  loadEveryoneYear(currentYearFilter);
}

// Load Everyone view for a specific year
function loadEveryoneYear(year: string) {
  if (!everyoneData) return;

  currentYearFilter = year;
  updateYearFilterActive(year);

  let sent: number, received: number, monthly, heatmap, attachments;

  if (year === 'all') {
    sent = everyoneData.total_sent;
    received = everyoneData.total_received;
    monthly = everyoneData.monthly;
    heatmap = everyoneData.time_heatmap;
    attachments = everyoneData.attachments;

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
    monthly = yearData.monthly;
    heatmap = yearData.time_heatmap;
    attachments = yearData.attachments;

    // Show top contacts for this year
    if (yearData.top_contacts && yearData.top_contacts.length > 0) {
      topContactsYear.textContent = year;
      renderTopContacts(yearData.top_contacts);
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

    // Hide month/year toggle for single year
    chartToggle.style.display = 'none';
    // Reset to month view if currently on year view
    if (currentView === 'year') {
      currentView = 'month';
      toggleButtons.forEach(b => b.classList.toggle('active', (b as HTMLButtonElement).dataset.view === 'month'));
    }
  }

  // Update header
  contactNameEl.textContent = 'iMessage Stats';
  textingSince.textContent = '';

  // Update stats
  const total = sent + received;
  statTotal.innerHTML = `<span class="num">${formatNumber(total)}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(received)}</span> received`;

  // Update attachment details
  renderAttachmentDetails(attachments);

  // Update chart and heatmap
  currentContactData = { monthly } as ContactData;
  renderChart();
  renderHeatmap(heatmap);
}

// Event listeners
contactList.addEventListener('click', (e) => {
  const li = (e.target as HTMLElement).closest('li') as HTMLLIElement;
  if (li) {
    loadContact(
      li.dataset.filename || '',
      li.dataset.name || '',
      parseInt(li.dataset.total || '0'),
      parseInt(li.dataset.sent || '0'),
      parseInt(li.dataset.received || '0'),
      li.dataset.first || ''
    );
  }
});

searchInput.addEventListener('input', (e) => {
  renderContacts((e.target as HTMLInputElement).value);
});

// Everyone tab click
everyoneTab.addEventListener('click', () => {
  currentYearFilter = 'all';
  loadEveryone();
});

// Year filter button click
yearFilterGrid.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement;
  if (btn) {
    const year = btn.dataset.year || 'all';
    const newHash = year === 'all' ? '#everyone' : `#everyone/${year}`;
    history.pushState(null, '', newHash);
    loadEveryoneYear(year);
  }
});

// Top contacts card click
topContactsGrid.addEventListener('click', (e) => {
  const card = (e.target as HTMLElement).closest('.top-contact-card') as HTMLDivElement;
  if (card) {
    const filename = card.dataset.filename;
    const contact = contacts.find(c => c.filename === filename);
    if (contact) {
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date || '');
    }
  }
});

// Keyboard navigation (includes Everyone tab)
document.addEventListener('keydown', (e) => {
  // Skip if typing in search
  if (document.activeElement === searchInput && searchInput.value) return;

  // Left/right arrows for year filter navigation on aggregate view
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && isEveryoneView && everyoneData) {
    e.preventDefault();

    const yearOptions = ['all', ...everyoneData.years];
    let idx = yearOptions.indexOf(currentYearFilter);
    if (idx === -1) idx = 0;

    if (e.key === 'ArrowLeft') {
      idx = idx > 0 ? idx - 1 : yearOptions.length - 1;
    } else {
      idx = idx < yearOptions.length - 1 ? idx + 1 : 0;
    }

    const newYear = yearOptions[idx];
    const newHash = newYear === 'all' ? '#everyone' : `#everyone/${newYear}`;
    history.pushState(null, '', newHash);
    loadEveryoneYear(newYear);

    // Focus the newly active button
    const activeBtn = yearFilterGrid.querySelector('button.active') as HTMLButtonElement;
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
    const targetItem = items[currentIndex] as HTMLLIElement;
    if (targetItem) {
      targetItem.scrollIntoView({ block: 'nearest' });
      loadContact(
        targetItem.dataset.filename || '',
        targetItem.dataset.name || '',
        parseInt(targetItem.dataset.total || '0'),
        parseInt(targetItem.dataset.sent || '0'),
        parseInt(targetItem.dataset.received || '0'),
        targetItem.dataset.first || ''
      );
    }
  }
});

toggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    toggleButtons.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentView = (btn as HTMLButtonElement).dataset.view as 'month' | 'year';
    renderChart();
  });
});

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

    const tooltipRect = heatmapTooltip.getBoundingClientRect();
    let left = e.clientX - rect.left + 10;
    let top = e.clientY - rect.top - tooltipRect.height - 5;

    if (e.clientX + tooltipRect.width + 20 > window.innerWidth) {
      left = e.clientX - rect.left - tooltipRect.width - 10;
    }
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

openSettingsBtn.addEventListener('click', () => {
  window.electronAPI.permissions.openSettings();
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
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date || '');
    } else {
      currentYearFilter = 'all';
      loadEveryone();
    }
  }
});

// Refresh data when database changes
async function refreshData() {
  showLoading('Refreshing data...', 0);

  window.electronAPI.export.onProgress(updateLoadingProgress);

  const result = await window.electronAPI.export.start();
  if (result.success) {
    contacts = await window.electronAPI.contacts.list();
    everyoneData = await window.electronAPI.everyone.get();
    renderContacts(searchInput.value);

    // Update everyone tab total
    if (everyoneData) {
      everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
      renderYearFilter(everyoneData.years);
    }

    // Reload current view
    const hash = window.location.hash.slice(1);
    if (hash === 'everyone' || hash.startsWith('everyone/') || isEveryoneView) {
      loadEveryoneYear(currentYearFilter);
    } else if (hash && currentContactData) {
      const contact = contacts.find((c) => c.filename === hash);
      if (contact) {
        const data = await window.electronAPI.contacts.get(contact.filename);
        if (data) {
          currentContactData = data;
          renderChart();
          renderPatterns(data);
          renderAttachmentDetails(data.attachments);
          renderHeatmap(data.time_heatmap);
        }
      }
    }
  }

  hideLoading();
}

// Initialize
async function init() {
  // Listen for database changes
  window.electronAPI.data.onDatabaseChanged(() => {
    refreshData();
  });

  // Also listen for permission status events (for future updates)
  window.electronAPI.permissions.onStatus(async (status) => {
    if (status.hasFullDiskAccess) {
      hideOnboarding();
    }
  });

  // Proactively check permissions and start
  const hasAccess = await window.electronAPI.permissions.check();

  if (!hasAccess) {
    showOnboarding();

    // Poll for access
    const pollInterval = setInterval(async () => {
      const granted = await window.electronAPI.permissions.check();
      if (granted) {
        clearInterval(pollInterval);
        hideOnboarding();
        await startExport();
      }
    }, 2000);
  } else {
    // Check if we have data already
    const isLoaded = await window.electronAPI.data.isLoaded();
    if (isLoaded) {
      contacts = await window.electronAPI.contacts.list();
      everyoneData = await window.electronAPI.everyone.get();
      renderContacts();

      // Update everyone tab total
      if (everyoneData) {
        everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
        renderYearFilter(everyoneData.years);
      }

      restoreSelection();
    } else {
      await startExport();
    }
  }
}

async function startExport() {
  showLoading('Starting export...', 0);

  window.electronAPI.export.onProgress(updateLoadingProgress);

  const result = await window.electronAPI.export.start();

  if (result.success) {
    contacts = await window.electronAPI.contacts.list();
    everyoneData = await window.electronAPI.everyone.get();
    renderContacts();

    // Update everyone tab total
    if (everyoneData) {
      everyoneTotal.textContent = `${formatNumber(everyoneData.total_sent + everyoneData.total_received)} messages`;
      renderYearFilter(everyoneData.years);
    }

    hideLoading();
    restoreSelection();
  } else {
    loadingMessage.textContent = `Error: ${result.error}`;
  }
}

function restoreSelection() {
  const hash = window.location.hash.slice(1);
  isNavigatingFromPopState = true;

  if (hash === 'everyone' || hash === '') {
    // Default to Everyone view
    loadEveryone();
  } else if (hash.startsWith('everyone/')) {
    // Everyone view with year filter
    const year = hash.split('/')[1];
    if (everyoneData && everyoneData.years.includes(year)) {
      currentYearFilter = year;
    }
    loadEveryone();
  } else {
    // Contact view
    const contact = contacts.find((c) => c.filename === hash);
    if (contact) {
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date || '');
      const activeItem = contactList.querySelector('li.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    } else {
      // Invalid hash, default to Everyone
      loadEveryone();
    }
  }
}

init();
