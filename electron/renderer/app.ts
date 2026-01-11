import './style.css';
import { Chart, registerables, Tooltip, ChartType, TooltipPositionerFunction, Plugin, BarElement } from 'chart.js';
import type { ContactSummary, ContactData, ExportProgress } from '../../src/exporter/types';

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
  // Update URL hash
  history.replaceState(null, '', `#${filename}`);

  // Update active state
  document.querySelectorAll('#contact-list li').forEach((li) => {
    li.classList.toggle('active', (li as HTMLLIElement).dataset.filename === filename);
  });

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

document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  if (document.activeElement === searchInput && searchInput.value) return;

  e.preventDefault();

  const items = Array.from(contactList.querySelectorAll('li'));
  if (items.length === 0) return;

  const activeItem = contactList.querySelector('li.active');
  let currentIndex = activeItem ? items.indexOf(activeItem as HTMLLIElement) : -1;

  if (e.key === 'ArrowDown') {
    currentIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
  } else if (e.key === 'ArrowUp') {
    currentIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
  }

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

// Refresh data when database changes
async function refreshData() {
  showLoading('Refreshing data...', 0);

  window.electronAPI.export.onProgress(updateLoadingProgress);

  const result = await window.electronAPI.export.start();
  if (result.success) {
    contacts = await window.electronAPI.contacts.list();
    renderContacts(searchInput.value);

    // Reload current contact if selected
    const hash = window.location.hash.slice(1);
    if (hash && currentContactData) {
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
      renderContacts();
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
    renderContacts();
    hideLoading();
    restoreSelection();
  } else {
    loadingMessage.textContent = `Error: ${result.error}`;
  }
}

function restoreSelection() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    const contact = contacts.find((c) => c.filename === hash);
    if (contact) {
      loadContact(contact.filename, contact.name, contact.total, contact.sent, contact.received, contact.first_date || '');
      const activeItem = contactList.querySelector('li.active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}

init();
