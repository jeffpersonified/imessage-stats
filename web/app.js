// Colors - read from CSS variables for single source of truth
const styles = getComputedStyle(document.documentElement);
const colors = {
  sent: styles.getPropertyValue("--sent").trim(),
  received: styles.getPropertyValue("--received").trim(),
};

// State
let contacts = [];
let chart = null;
let temperatureChart = null;
let currentContactData = null;
let currentContactName = "";
let currentView = "month";
let currentFirstName = "";
let everyoneData = null;
let currentYearFilter = "all";
let currentContactYearFilter = "all";
let currentAnalysisYearFilter = "all";
let isEveryoneView = false;
let isNavigatingFromPopState = false; // Flag to avoid duplicate history entries
let swearWordsRevealed = false; // Persists across year filter changes once revealed
let swearWordScrambleIntervals = []; // Intervals for per-character scramble effect

// LLM theme analysis status tracking
let llmStatus = null; // { pending: [...filenames...], completed: [...], total: N }
let llmPollingInterval = null;
let currentContactFilename = "";

// Fake names for screenshots (use with ./scripts/start --fake)
const FAKE_MODE = new URLSearchParams(window.location.search).has("fake");
const fakeNames = [
  "Emma Rodriguez",
  "Liam Chen",
  "Olivia Patel",
  "Noah Kim",
  "Ava Thompson",
  "Ethan Nakamura",
  "Sophia Williams",
  "Mason Garcia",
  "Isabella Jones",
  "Lucas Brown",
  "Mia Anderson",
  "Oliver Davis",
  "Charlotte Wilson",
  "Elijah Martinez",
  "Amelia Taylor",
  "James Moore",
  "Harper Jackson",
  "Benjamin White",
  "Evelyn Harris",
  "Alexander Clark",
  "Abigail Lewis",
  "William Robinson",
  "Emily Walker",
  "Henry Young",
  "Elizabeth Hall",
  "Sebastian Allen",
  "Sofia King",
  "Jack Wright",
  "Avery Scott",
  "Daniel Green",
];

// Unicode characters that need variation selector (U+FE0F) for emoji presentation
const EMOJI_NEEDS_VS = [
  "\u2764",
  "\u2665",
  "\u2663",
  "\u2660",
  "\u2666",
  "\u2618",
  "\u2702",
  "\u2705",
  "\u2708",
  "\u2709",
  "\u270A",
  "\u270B",
  "\u270C",
  "\u270F",
  "\u2712",
  "\u2714",
  "\u2716",
  "\u2728",
  "\u2733",
  "\u2734",
  "\u2744",
  "\u2747",
  "\u2753",
  "\u2754",
  "\u2755",
  "\u2757",
  "\u2763",
  "\u2795",
  "\u2796",
  "\u2797",
  "\u27A1",
  "\u2934",
  "\u2935",
  "\u2B05",
  "\u2B06",
  "\u2B07",
  "\u2B1B",
  "\u2B1C",
  "\u2B50",
  "\u2B55",
  "\u3030",
  "\u303D",
  "\u3297",
  "\u3299",
];

// Register custom tooltip positioner that keeps tooltip at fixed vertical position
Chart.Tooltip.positioners.fixedTop = function (elements, eventPosition) {
  if (!elements.length) return false;
  const chart = elements[0].element.$context.chart;
  return {
    x: eventPosition.x,
    y: chart.chartArea.top,
  };
};

// Plugin to draw vertical highlight band behind hovered bar
const hoverHighlightPlugin = {
  id: "hoverHighlight",
  beforeDatasetsDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) return;

    const { ctx, chartArea } = chart;
    const element = active[0].element;
    const barWidth = element.width;
    const x = element.x - barWidth / 2 - 4;
    const width = barWidth + 8;

    ctx.save();
    ctx.fillStyle = "rgba(255, 255, 255, 0.03)";
    ctx.fillRect(x, chartArea.top, width, chartArea.bottom - chartArea.top);
    ctx.restore();
  },
};

// DOM elements
const contactList = document.getElementById("contact-list");
const searchInput = document.getElementById("search");
const welcome = document.getElementById("welcome");
const chartContainer = document.getElementById("chart-container");
const contactNameEl = document.getElementById("contact-name");
const statTotal = document.getElementById("stat-total");
const statSent = document.getElementById("stat-sent");
const statReceived = document.getElementById("stat-received");
const toggleButtons = document.querySelectorAll(".toggle button");
const convoStarterEl = document.getElementById("convo-starter");
const convoEnderEl = document.getElementById("convo-ender");
const responseTimeEl = document.getElementById("response-time");
const laughComparisonEl = document.getElementById("laugh-comparison");
const swearComparisonEl = document.getElementById("swear-comparison");
const questionRatioEl = document.getElementById("question-ratio");
const statTotalDetail = document.getElementById("stat-total-detail");
const statSentDetail = document.getElementById("stat-sent-detail");
const statReceivedDetail = document.getElementById("stat-received-detail");
const heatmapCanvas = document.getElementById("heatmap");
const heatmapTooltip = document.getElementById("heatmap-tooltip");
const heatmapLabel = document.getElementById("heatmap-label");
const everyoneTab = document.getElementById("everyone-tab");
const everyoneTotal = document.getElementById("everyone-total");
const yearFilterSection = document.getElementById("year-filter-section");
const yearFilterGrid = document.getElementById("year-filter");
const contactYearFilterSection = document.getElementById(
  "contact-year-filter-section"
);
const contactYearFilterGrid = document.getElementById("contact-year-filter");
const topContactsSection = document.getElementById("top-contacts-section");
const topContactsYear = document.getElementById("top-contacts-year");
const topContactsGrid = document.getElementById("top-contacts");
const busiestMonthSection = document.getElementById("busiest-month-section");
const busiestMonthEl = document.getElementById("busiest-month");
const patternsSection = document.querySelector(".patterns");
const chartToggle = document.querySelector(".chart-section .toggle");
const analysisSection = document.getElementById("analysis-section");
const analysisYearFilter = document.getElementById("analysis-year-filter");
const analysisYearFilterGrid = document.getElementById(
  "analysis-year-filter-grid"
);
const contentEl = document.querySelector(".content");
const linksDialog = document.getElementById("links-dialog");
const linksList = document.getElementById("links-list");
const viewAllLinksBtn = document.getElementById("view-all-links");
const messageStyleCard = document.getElementById("message-style-card");
const bubblesSent = document.getElementById("bubbles-sent");
const bubblesReceived = document.getElementById("bubbles-received");
const styleNarrativeText = document.getElementById("style-narrative-text");
const styleLengthYou = document.getElementById("style-length-you");
const styleLengthThem = document.getElementById("style-length-them");
const styleTurnYou = document.getElementById("style-turn-you");
const styleTurnThem = document.getElementById("style-turn-them");

// Store current links data for the dialog
let currentLinksData = null;

// Heatmap state for hover
let currentHeatmapData = null;
const dayNames = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatHour(hour) {
  if (hour === 0) return "12am";
  if (hour === 12) return "12pm";
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

// Get available years from monthly data
function getYearsFromMonthly(monthly) {
  const years = new Set();
  for (const m of monthly) {
    years.add(m.month.substring(0, 4));
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a)); // Descending
}

// Filter monthly data by year
function filterMonthlyByYear(monthly, year) {
  if (year === "all") return monthly;
  return monthly.filter((m) => m.month.startsWith(year));
}

// Render contact year filter buttons
function renderContactYearFilter(years) {
  if (years.length <= 1) {
    contactYearFilterSection.style.display = "none";
    return;
  }
  contactYearFilterGrid.innerHTML =
    '<button data-year="all" class="active">All time</button>' +
    years.map((y) => `<button data-year="${y}">${y}</button>`).join("");
  contactYearFilterSection.style.display = "block";
}

// Update active state on contact year filter buttons
function updateContactYearFilterActive(year) {
  contactYearFilterGrid.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.year === year);
  });
}

// Render contact list
function renderContacts(filter = "") {
  const filtered = contacts.filter(
    (c) =>
      c.sidebar !== false && c.name.toLowerCase().includes(filter.toLowerCase())
  );

  contactList.innerHTML = filtered
    .map((c) => {
      const isPending = isContactPending(c.filename);
      const metaText = isPending
        ? "Processing..."
        : `${formatNumber(c.total)} messages`;
      const metaClass = isPending ? "contact-meta processing" : "contact-meta";
      return `
      <li data-filename="${c.filename}" data-name="${c.name}"
          data-total="${c.total}" data-sent="${c.sent}" data-received="${
        c.received
      }"
          data-first="${c.first_date || ""}">
        <div class="contact-name">${c.name}</div>
        <div class="${metaClass}">${metaText}</div>
      </li>
    `;
    })
    .join("");
}

// Format date as "Feb 2016"
function formatSinceDate(dateStr) {
  if (!dateStr) return "";
  const [year, month] = dateStr.split("-");
  const date = new Date(year, month - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// Load and display data for a contact
async function loadContact(filename, name, total, sent, received, firstDate) {
  isEveryoneView = false;
  currentContactFilename = filename;
  swearWordsRevealed = false; // Reset reveal state for new contact

  // Clear any scramble animation from previous contact
  clearScrambleIntervals();

  // Update URL hash for persistence
  if (isNavigatingFromPopState) {
    isNavigatingFromPopState = false;
  } else {
    history.pushState(null, "", `#${filename}`);
  }

  // Update active state
  everyoneTab.classList.remove("active");
  document.querySelectorAll("#contact-list li").forEach((li) => {
    li.classList.toggle("active", li.dataset.filename === filename);
  });

  // Hide Everyone-specific elements, show contact-specific
  yearFilterSection.style.display = "none";
  topContactsSection.style.display = "none";
  busiestMonthSection.style.display = "none";
  document.getElementById("global-emoji-section").style.display = "none";
  patternsSection.style.display = "block";

  // Reset year filters and scroll position
  currentContactYearFilter = "all";
  currentView = "month";
  yearFilterSection.classList.remove("scrolled");
  contactYearFilterSection.classList.remove("scrolled");
  contentEl.scrollTop = 0;

  // Update header and extract first name
  contactNameEl.textContent = name;
  currentContactName = name;
  currentFirstName = name.split(" ")[0];

  // Update "texting since"
  const sinceEl = document.getElementById("texting-since");
  if (firstDate) {
    sinceEl.textContent = `Texting since ${formatSinceDate(firstDate)}`;
  } else {
    sinceEl.textContent = "";
  }

  // Show header and chart container
  welcome.style.display = "none";
  document.getElementById("contact-header").style.display = "flex";
  chartContainer.style.display = "block";

  // Update stats section
  statTotal.innerHTML = `<span class="num">${formatNumber(
    total
  )}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(
    received
  )}</span> received`;

  // Fetch contact data
  try {
    const response = await fetch(`data/messages/${filename}.json`);
    currentContactData = await response.json();

    // Get available years and render year filter
    const years = getYearsFromMonthly(currentContactData.monthly);
    renderContactYearFilter(years);

    // Show/hide chart toggle based on all-time view
    chartToggle.style.display = "flex";
    toggleButtons.forEach((b) =>
      b.classList.toggle("active", b.dataset.view === "month")
    );

    // Render all content with current filter
    renderContactYear(currentContactYearFilter);
    renderAnalysis(currentContactData.analysis, name);
  } catch (err) {
    console.error("Failed to load contact data:", err);
  }
}

// Format seconds as human-readable time
function formatTime(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 60) return `${seconds} seconds`;
  if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  const hours = Math.round(seconds / 3600);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

// Scramble characters (letters and symbols)
const SCRAMBLE_CHARS = "abcdefghijklmnopqrstuvwxyz@#$%&*!?~^+";

// Get a random character
function randomChar() {
  return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
}

// Clear all scramble intervals
function clearScrambleIntervals() {
  swearWordScrambleIntervals.forEach((id) => clearInterval(id));
  swearWordScrambleIntervals = [];
}

// Start the scramble animation with each character on its own timer
function startScrambleAnimation(element, word) {
  // Clear any existing intervals
  clearScrambleIntervals();

  const chars = Array.from({ length: word.length }, () => randomChar());

  // Set initial scrambled state
  element.textContent = chars.join("");

  // Create independent interval for each character position
  // Use staggered base intervals (400-600ms) so they don't sync up
  for (let i = 0; i < chars.length; i++) {
    const baseInterval = 400 + Math.random() * 200; // 400-600ms per character
    const intervalId = setInterval(() => {
      if (element.classList.contains("obscured")) {
        chars[i] = randomChar();
        element.textContent = chars.join("");
      } else {
        clearInterval(intervalId);
      }
    }, baseInterval);
    swearWordScrambleIntervals.push(intervalId);
  }
}

// Reveal the word with sequential left-to-right animation
function revealSwearWord(element, word) {
  swearWordsRevealed = true;

  // Stop scrambling
  clearScrambleIntervals();

  element.classList.remove("obscured");
  element.classList.add("revealing");

  const chars = word.split("");
  let revealedCount = 0;

  // Reveal one character at a time from left to right
  const revealInterval = setInterval(() => {
    if (revealedCount >= chars.length) {
      clearInterval(revealInterval);
      element.classList.remove("revealing");
      element.classList.add("revealed");
      element.textContent = word;
      return;
    }

    // Build the display: revealed chars + scrambled remainder
    const revealed = chars.slice(0, revealedCount + 1).join("");
    const scrambledRemainder = chars
      .slice(revealedCount + 1)
      .map(() => randomChar())
      .join("");

    element.textContent = revealed + scrambledRemainder;
    revealedCount++;
  }, 60);
}

// Re-obscure the word and restart scramble animation
function obscureSwearWord(element, word) {
  swearWordsRevealed = false;
  element.classList.remove("revealed");
  element.classList.add("obscured");
  startScrambleAnimation(element, word);
}

// Render conversation patterns (response times, conversation starters, profanity comparison)
function renderPatterns(data, year = "all") {
  const name = currentFirstName;

  // Get year-specific response stats (new format has 'all' and year keys)
  // Also handle old format where stats are directly in response_stats (no 'all' key)
  const responseStatsAll = data.response_stats || {};
  let stats;
  if (responseStatsAll.all || responseStatsAll[year]) {
    // New format with per-year stats
    stats = responseStatsAll[year] || responseStatsAll.all || {};
  } else {
    // Old format - stats are directly in response_stats
    stats = responseStatsAll;
  }

  // Use past tense for years before the current year
  const currentYear = new Date().getFullYear().toString();
  const usePastTense = year !== "all" && year < currentYear;

  // Conversation starter
  const starterIcon = '<span class="pattern-icon">▶</span>';
  if (stats.you_start_pct !== null && stats.you_start_pct !== undefined) {
    const youPct = Math.round(stats.you_start_pct * 100);
    const themPct = 100 - youPct;
    if (youPct > themPct) {
      const verb = usePastTense ? "started" : "start";
      convoStarterEl.innerHTML = `${starterIcon}<span class="you">You</span> ${verb} the conversation <span class="stat-highlight">${youPct}%</span> of the time`;
    } else if (themPct > youPct) {
      const verb = usePastTense ? "started" : "starts";
      convoStarterEl.innerHTML = `${starterIcon}<span class="them">${name}</span> ${verb} the conversation <span class="stat-highlight">${themPct}%</span> of the time`;
    } else {
      const verb = usePastTense ? "started" : "start";
      convoStarterEl.innerHTML = `${starterIcon}You both ${verb} conversations equally`;
    }
  } else {
    convoStarterEl.textContent = "";
  }

  // Conversation ender (who sends the last message)
  const enderIcon = '<span class="pattern-icon">■</span>';
  if (stats.you_end_pct !== null && stats.you_end_pct !== undefined) {
    const youPct = Math.round(stats.you_end_pct * 100);
    const themPct = 100 - youPct;
    if (youPct > themPct) {
      const verb = usePastTense ? "tended" : "tend";
      convoEnderEl.innerHTML = `${enderIcon}<span class="you">You</span> ${verb} to have the final word, being the last person to send a message in <span class="stat-highlight">${youPct}%</span> of chats`;
    } else if (themPct > youPct) {
      const verb = usePastTense ? "tended" : "tends";
      convoEnderEl.innerHTML = `${enderIcon}<span class="them">${name}</span> ${verb} to have the final word, being the last person to send a message in <span class="stat-highlight">${themPct}%</span> of chats`;
    } else {
      convoEnderEl.innerHTML = `${enderIcon}You both have the final word equally`;
    }
  } else {
    convoEnderEl.textContent = "";
  }

  // Response times
  const responseIcon = '<span class="pattern-icon">⏱</span>';
  const youTime = formatTime(stats.you_avg_seconds);
  const themTime = formatTime(stats.them_avg_seconds);

  if (youTime && themTime) {
    const verb = usePastTense ? "responded" : "responds";
    const youVerb = usePastTense ? "responded" : "respond";
    responseTimeEl.innerHTML = `${responseIcon}<span class="them">${name}</span> ${verb} in about ${themTime}, <span class="you">you</span> ${youVerb} in about ${youTime}`;
  } else if (youTime) {
    const verb = usePastTense ? "responded" : "respond";
    responseTimeEl.innerHTML = `${responseIcon}<span class="you">You</span> ${verb} in about ${youTime}`;
  } else if (themTime) {
    const verb = usePastTense ? "responded" : "responds";
    responseTimeEl.innerHTML = `${responseIcon}<span class="them">${name}</span> ${verb} in about ${themTime}`;
  } else {
    responseTimeEl.textContent = "";
  }

  // Laughter comparison (who makes the other person laugh more)
  // sent = laughs in YOUR messages (they made you laugh)
  // received = laughs in THEIR messages (you made them laugh)
  const laughIcon = '<span class="pattern-icon">☺</span>';
  const laughterData = data.analysis?.laughter;
  if (laughterData) {
    const yearData = laughterData[year] || laughterData.all || {};
    const theyMadeYouLaugh = yearData.sent || 0;
    const youMadeThemLaugh = yearData.received || 0;
    const topSent = yearData.top_sent; // Your most common laugh
    const topReceived = yearData.top_received; // Their most common laugh

    if (theyMadeYouLaugh > 0 || youMadeThemLaugh > 0) {
      let mainText = "";
      let detailText = "";

      if (youMadeThemLaugh > theyMadeYouLaugh) {
        const verb = usePastTense ? "made" : "make";
        mainText = `${laughIcon}<span class="you">You</span> ${verb} <span class="them">${name}</span> laugh more often`;
        if (topReceived) {
          detailText = ` — big "${topReceived}" energy`;
        }
      } else if (theyMadeYouLaugh > youMadeThemLaugh) {
        const verb = usePastTense ? "made" : "makes";
        mainText = `${laughIcon}<span class="them">${name}</span> ${verb} you laugh more often`;
        if (topSent) {
          detailText = ` — big "${topSent}" energy`;
        }
      } else {
        const verb = usePastTense ? "made" : "make";
        mainText = `${laughIcon}You both ${verb} each other laugh equally`;
      }

      laughComparisonEl.innerHTML = mainText + detailText;
    } else {
      laughComparisonEl.textContent = "";
    }
  } else {
    laughComparisonEl.textContent = "";
  }

  // Profanity comparison (who swears more, with favorite word)
  // Clear any existing scramble animation
  clearScrambleIntervals();

  const swearIcon = '<span class="pattern-icon">※</span>';
  const profanityData = data.analysis?.profanity;
  if (profanityData) {
    const yearData = profanityData[year] || profanityData.all || {};
    const youCount = yearData.sent || 0;
    const themCount = yearData.received || 0;
    const topSent = yearData.top_sent?.[0]; // Your top swear word
    const topReceived = yearData.top_received?.[0]; // Their top swear word

    if (youCount > 0 || themCount > 0) {
      let mainText = "";
      let favoriteWord = null;
      let favoriteLabel = "";

      if (youCount > themCount) {
        const verb = usePastTense ? "swore" : "swear";
        mainText = `${swearIcon}<span class="you">You</span> ${verb} more`;
        if (topSent) {
          favoriteWord = topSent.word;
          favoriteLabel = "Your favorite:";
        }
      } else if (themCount > youCount) {
        const verb = usePastTense ? "swore" : "swears";
        mainText = `${swearIcon}<span class="them">${name}</span> ${verb} more`;
        if (topReceived) {
          favoriteWord = topReceived.word;
          favoriteLabel = `${name}'s favorite:`;
        }
      } else {
        const verb = usePastTense ? "swore" : "swear";
        mainText = `${swearIcon}You both ${verb} equally`;
        // Show your favorite if tied
        if (topSent) {
          favoriteWord = topSent.word;
          favoriteLabel = "Your favorite:";
        }
      }

      // Add favorite swear word (matrix scramble until clicked)
      if (favoriteWord) {
        const stateClass = swearWordsRevealed ? "revealed" : "obscured";
        const displayWord = swearWordsRevealed ? favoriteWord : ""; // Will be set by animation
        mainText += `. <span class="favorite-swear">${favoriteLabel} <span class="swear-word ${stateClass}" data-word="${favoriteWord}">${displayWord}</span></span>`;
      }

      swearComparisonEl.innerHTML = mainText;

      // Set up the swear word element with toggle behavior
      const swearWordEl = swearComparisonEl.querySelector(".swear-word");
      if (swearWordEl && favoriteWord) {
        if (!swearWordsRevealed) {
          // Start matrix scramble animation
          startScrambleAnimation(swearWordEl, favoriteWord);
        } else {
          // Already revealed, just show the word
          swearWordEl.textContent = favoriteWord;
        }

        // Click to toggle between revealed and obscured
        swearWordEl.addEventListener("click", () => {
          if (swearWordEl.classList.contains("obscured")) {
            revealSwearWord(swearWordEl, favoriteWord);
          } else if (swearWordEl.classList.contains("revealed")) {
            obscureSwearWord(swearWordEl, favoriteWord);
          }
          // Ignore clicks during 'revealing' animation
        });
      }
    } else {
      swearComparisonEl.textContent = "";
    }
  } else {
    swearComparisonEl.textContent = "";
  }

  // Question ratio (who asks more questions)
  const questionIcon = '<span class="pattern-icon">?</span>';
  const questionData = data.analysis?.questions;
  if (questionData) {
    const yearData = questionData[year] || questionData.all || {};
    const youQuestions = yearData.sent || 0;
    const themQuestions = yearData.received || 0;
    const totalQuestions = youQuestions + themQuestions;

    if (totalQuestions > 0) {
      const youPct = Math.round((youQuestions / totalQuestions) * 100);
      const themPct = 100 - youPct;
      const totalFormatted = totalQuestions.toLocaleString();
      const verb = usePastTense ? "asked" : "have asked";

      let mainText = `${questionIcon}<span class="you">You</span> and <span class="them">${name}</span> ${verb} each other ${totalFormatted} questions — `;

      if (youQuestions > themQuestions) {
        mainText += `<span class="you">You</span> asked <span class="stat-highlight">${youPct}%</span> of them`;
      } else if (themQuestions > youQuestions) {
        mainText += `<span class="them">${name}</span> asked <span class="stat-highlight">${themPct}%</span> of them`;
      } else {
        mainText += `<span class="you">You</span> each asked half`;
      }

      questionRatioEl.innerHTML = mainText;
    } else {
      questionRatioEl.textContent = "";
    }
  } else {
    questionRatioEl.textContent = "";
  }
}

// Render contact view for a specific year filter
function renderContactYear(year) {
  if (!currentContactData) return;

  currentContactYearFilter = year;
  updateContactYearFilterActive(year);

  const monthly = currentContactData.monthly;
  const filteredMonthly = filterMonthlyByYear(monthly, year);

  // Calculate stats from filtered monthly data
  let sent = 0,
    received = 0;
  for (const m of filteredMonthly) {
    sent += m.sent;
    received += m.received;
  }
  const total = sent + received;

  // Update stats display
  statTotal.innerHTML = `<span class="num">${formatNumber(
    total
  )}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(
    received
  )}</span> received`;

  // Get links and attachments for the selected year
  const analysisLinks = currentContactData.analysis?.links;
  let linksData = null;
  let attachmentsData = null;

  if (year === "all") {
    // Use all-time data
    if (analysisLinks?.all) {
      linksData = {
        links_sent: analysisLinks.all.sent?.total || 0,
        links_received: analysisLinks.all.received?.total || 0,
      };
    }
    attachmentsData = currentContactData.attachments;
  } else {
    // Use year-specific data if available
    if (analysisLinks?.[year]) {
      linksData = {
        links_sent: analysisLinks[year].sent?.total || 0,
        links_received: analysisLinks[year].received?.total || 0,
      };
    }
    // Use year-specific attachments if available, otherwise compute from filtered data
    attachmentsData = currentContactData.attachments_by_year?.[year] || null;
  }

  renderAttachmentDetails(attachmentsData, linksData);

  // Handle chart toggle visibility
  if (year === "all") {
    chartToggle.style.display = "flex";
    // Keep current view selection
  } else {
    // Force month view and hide toggle for single year
    chartToggle.style.display = "none";
    currentView = "month";
    toggleButtons.forEach((b) =>
      b.classList.toggle("active", b.dataset.view === "month")
    );
  }

  // Render chart with filtered data
  renderChart(filteredMonthly);

  // Render heatmap - use year-specific if available, otherwise use all-time
  const heatmapData =
    year === "all"
      ? currentContactData.time_heatmap
      : currentContactData.heatmap_by_year?.[year] ||
        currentContactData.time_heatmap;
  renderHeatmap(heatmapData, year);

  // Render patterns (response time, convo starter, swear comparison) with year filter
  renderPatterns(currentContactData, year);
}

// Get available years from analysis data (intersection of years across all analyzers)
function getAnalysisYears(analysis) {
  const yearSets = [];

  // Collect years from each analyzer
  for (const [key, data] of Object.entries(analysis || {})) {
    if (typeof data === "object" && data !== null) {
      const years = Object.keys(data).filter(
        (k) => k !== "all" && /^\d{4}$/.test(k)
      );
      if (years.length > 0) {
        yearSets.push(new Set(years));
      }
    }
  }

  if (yearSets.length === 0) return [];

  // Get intersection of all year sets (years present in ALL analyzers)
  // Actually, we want union - show all years that have any data
  const allYears = new Set();
  yearSets.forEach((set) => set.forEach((y) => allYears.add(y)));

  return Array.from(allYears).sort((a, b) => b.localeCompare(a)); // Descending
}

// Render analysis year filter buttons
function renderAnalysisYearFilter(years) {
  if (years.length <= 1) {
    // No point showing filter with only one year
    analysisYearFilter.style.display = "none";
    return;
  }

  analysisYearFilterGrid.innerHTML =
    '<button data-year="all" class="active">All time</button>' +
    years.map((y) => `<button data-year="${y}">${y}</button>`).join("");
  analysisYearFilter.style.display = "block";
}

// Update active state on analysis year filter buttons
function updateAnalysisYearFilterActive(year) {
  analysisYearFilterGrid.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.year === year);
  });
}

// Update analysis cards for a specific year filter
function updateAnalysisCardsForYear(year) {
  const analysis = currentContactData?.analysis;
  if (!analysis) return;

  currentAnalysisYearFilter = year;
  updateAnalysisYearFilterActive(year);

  if (analysis.temperature) {
    renderTemperature(analysis.temperature, currentContactName, year);
  }
  if (analysis.message_style) {
    renderMessageStyle(analysis.message_style, currentContactName, year);
  }
  if (analysis.links) {
    renderLinks(analysis.links, currentContactName, year);
  }
  if (analysis.emoji) {
    renderEmoji(analysis.emoji, currentContactName, year);
  }
}

// Render analysis section (temperature, links, keywords, themes)
function renderAnalysis(analysis, contactName) {
  const temperatureCard = document.getElementById("temperature-card");
  const linksCard = document.getElementById("links-card");

  // Hide section if no analysis data
  if (!analysis || Object.keys(analysis).length === 0) {
    analysisSection.style.display = "none";
    analysisYearFilter.style.display = "none";
    return;
  }

  // Show section
  analysisSection.style.display = "grid";

  // Hide analysis year filter - we now use the main contact year filter at the top
  analysisYearFilter.style.display = "none";
  currentAnalysisYearFilter = currentContactYearFilter;

  // Render temperature if available
  if (analysis.temperature) {
    renderTemperature(
      analysis.temperature,
      contactName,
      currentContactYearFilter
    );
    temperatureCard.style.display = "block";
  } else {
    temperatureCard.style.display = "none";
  }

  // Render message style if available
  if (analysis.message_style) {
    renderMessageStyle(
      analysis.message_style,
      contactName,
      currentContactYearFilter
    );
  } else {
    messageStyleCard.style.display = "none";
  }

  // Render links if available
  if (analysis.links) {
    renderLinks(analysis.links, contactName, currentContactYearFilter);
    linksCard.style.display = "block";
  } else {
    linksCard.style.display = "none";
  }

  // Render emoji if available
  const emojiCard = document.getElementById("emoji-card");
  if (analysis.emoji) {
    renderEmoji(analysis.emoji, contactName, currentContactYearFilter);
    emojiCard.style.display = "block";
  } else {
    emojiCard.style.display = "none";
  }

  // Render keywords if available
  const keywordsCard = document.getElementById("keywords-card");
  if (analysis.keywords) {
    renderKeywords(analysis.keywords, contactName, currentContactYearFilter);
    keywordsCard.style.display = "block";
  } else {
    keywordsCard.style.display = "none";
  }

  // Render LLM themes if available, or show loading state
  const themesCard = document.getElementById("themes-card");
  const tagsEl = document.getElementById("theme-tags");
  const summaryEl = document.getElementById("theme-summary");
  const evolutionEl = document.getElementById("theme-evolution");

  if (analysis.llm_themes) {
    renderLlmThemes(analysis.llm_themes, currentContactYearFilter);
    themesCard.style.display = "block";
  } else if (isContactPending(currentContactFilename)) {
    // Show loading state for pending contacts
    tagsEl.innerHTML =
      '<span class="theme-tag theme-loading">Analyzing...</span>';
    summaryEl.textContent =
      "AI theme analysis is running in the background. This will update automatically.";
    evolutionEl.style.display = "none";
    themesCard.style.display = "block";
  } else {
    themesCard.style.display = "none";
  }
}

// Generate unicode progress bar
function generateProgressBar(score, width = 48) {
  if (!score) return { filled: "", empty: "░".repeat(width) };
  const pct = (score - 1) / 4; // Scale 1-5 to 0-1
  const filledCount = Math.round(pct * width);
  const emptyCount = width - filledCount;
  return {
    filled: "█".repeat(filledCount),
    empty: "░".repeat(emptyCount),
  };
}

// Render temperature score card with bar visualization and line chart
function renderTemperature(tempData, contactName, year = "all") {
  const firstName = contactName.split(" ")[0];
  const youBarEl = document.getElementById("energy-bar-you");
  const themBarEl = document.getElementById("energy-bar-them");
  const youValueEl = document.getElementById("energy-value-you");
  const themValueEl = document.getElementById("energy-value-them");
  const themLabelEl = document.getElementById("energy-label-them");
  const detailEl = document.getElementById("temp-detail");

  // Get data for selected year (fall back to "all" if year doesn't exist)
  const yearData = tempData[year] || tempData.all || {};
  const youScore = yearData.sent?.score;
  const themScore = yearData.received?.score;

  // Update score values
  youValueEl.textContent = youScore ? youScore.toFixed(1) : "--";
  themValueEl.textContent = themScore ? themScore.toFixed(1) : "--";
  themLabelEl.textContent = firstName;

  // Generate unicode progress bars
  const youBar = generateProgressBar(youScore);
  const themBar = generateProgressBar(themScore);

  youBarEl.innerHTML = `<span class="filled">${youBar.filled}</span><span class="empty">${youBar.empty}</span>`;
  themBarEl.innerHTML = `<span class="filled">${themBar.filled}</span><span class="empty">${themBar.empty}</span>`;
  themBarEl.classList.add("received-progress");

  // Generate detail text based on comparison
  if (youScore && themScore) {
    const diff = Math.abs(youScore - themScore);
    if (diff < 0.3) {
      detailEl.textContent = "You both have similar energy";
    } else if (youScore > themScore) {
      detailEl.innerHTML = `<span class="you">You</span> bring more energy`;
    } else {
      detailEl.innerHTML = `<span class="them">${firstName}</span> brings more energy`;
    }
  } else {
    detailEl.textContent = "";
  }

  // Update custom legend and render the temperature line chart
  const legendEl = document.getElementById("temperature-chart-legend");
  legendEl.innerHTML = `
    <span class="legend-item"><span class="legend-dot sent"></span>You</span>
    <span class="legend-item"><span class="legend-dot received"></span>${firstName}</span>
  `;
  renderTemperatureChart(tempData, firstName, year);
}

// Render temperature line chart showing energy over time
function renderTemperatureChart(tempData, firstName, year = "all") {
  const ctx = document.getElementById("temperature-chart");
  if (!ctx) return;

  // Destroy existing chart
  if (temperatureChart) {
    temperatureChart.destroy();
    temperatureChart = null;
  }

  let chartData = [];
  let labels = [];
  let tooltipFormat;

  if (year === "all") {
    // Show yearly data
    const yearlyData = tempData.all?.by_year || [];
    if (yearlyData.length === 0) return;

    labels = yearlyData.map((d) => d.year);
    chartData = yearlyData;
    tooltipFormat = (idx) => chartData[idx].year;
  } else {
    // Show monthly data for the selected year
    const monthlyData = tempData[year]?.by_month || [];
    if (monthlyData.length === 0) return;

    labels = monthlyData.map((d) => {
      const [y, m] = d.month.split("-");
      return new Date(y, m - 1).toLocaleDateString("en-US", { month: "short" });
    });
    chartData = monthlyData;
    tooltipFormat = (idx) => {
      const [y, m] = chartData[idx].month.split("-");
      return new Date(y, m - 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });
    };
  }

  temperatureChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "You",
          data: chartData.map((d) => d.sent),
          borderColor: colors.sent,
          backgroundColor: "transparent",
          pointBackgroundColor: colors.sent,
          pointBorderColor: colors.sent,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          spanGaps: true,
        },
        {
          label: firstName,
          data: chartData.map((d) => d.received),
          borderColor: colors.received,
          backgroundColor: "transparent",
          pointBackgroundColor: colors.received,
          pointBorderColor: colors.received,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0.3,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: "#1a1a1a",
          titleColor: "#999",
          bodyColor: "#ccc",
          borderColor: "#333",
          borderWidth: 1,
          padding: 10,
          titleFont: { family: "SF Mono, Monaco, monospace", size: 11 },
          bodyFont: { family: "SF Mono, Monaco, monospace", size: 12 },
          displayColors: true,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          callbacks: {
            title: (items) => tooltipFormat(items[0].dataIndex),
            label: (ctx) =>
              ` ${ctx.dataset.label}: ${
                ctx.raw !== null ? ctx.raw.toFixed(1) : "--"
              }`,
            labelColor: (ctx) => ({
              borderColor: ctx.dataset.borderColor,
              backgroundColor: "#1a1a1a",
            }),
            labelTextColor: (ctx) => ctx.dataset.borderColor,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: "#333" },
          ticks: {
            color: "#666",
            font: { family: "SF Mono, Monaco, monospace", size: 10 },
            maxRotation: 0,
          },
        },
        y: {
          min: 1,
          max: 5,
          grid: { color: "#1a1a1a" },
          border: { display: false },
          ticks: {
            color: "#444",
            font: { family: "SF Mono, Monaco, monospace", size: 10 },
            stepSize: 1,
          },
        },
      },
    },
  });
}

// Render message style card with conversation shape visualization
function renderMessageStyle(styleData, contactName, year = "all") {
  if (!styleData || !messageStyleCard) {
    if (messageStyleCard) messageStyleCard.style.display = "none";
    return;
  }

  const firstName = contactName.split(" ")[0];

  // Get data for selected year (fall back to "all" if year doesn't exist)
  const yearData = styleData[year] || styleData.all || {};
  const sentMetrics = yearData.sent || {};
  const receivedMetrics = yearData.received || {};

  // Check if we have meaningful data
  if (!sentMetrics.total_messages && !receivedMetrics.total_messages) {
    messageStyleCard.style.display = "none";
    return;
  }

  messageStyleCard.style.display = "block";

  // Generate bubbles based on message style
  const sentBubbles = generateBubbles(sentMetrics, "sent");
  const receivedBubbles = generateBubbles(receivedMetrics, "received");

  bubblesSent.innerHTML = sentBubbles;
  bubblesReceived.innerHTML = receivedBubbles;

  // Generate narrative text
  const narrative = generateStyleNarrative(
    sentMetrics,
    receivedMetrics,
    firstName
  );
  styleNarrativeText.innerHTML = narrative;

  // Populate technical stats
  const youLength = sentMetrics.avg_length || 0;
  const themLength = receivedMetrics.avg_length || 0;
  const youTurn = sentMetrics.avg_per_turn || 1;
  const themTurn = receivedMetrics.avg_per_turn || 1;

  styleLengthYou.textContent = `${Math.round(youLength)} words`;
  styleLengthThem.textContent = `${Math.round(themLength)} words`;
  styleTurnYou.textContent = youTurn.toFixed(1);
  styleTurnThem.textContent = themTurn.toFixed(1);
}

// Generate bubble HTML based on message style metrics
function generateBubbles(metrics, direction) {
  const avgLength = metrics.avg_length || 0;
  const avgPerTurn = metrics.avg_per_turn || 1;

  // Determine number of bubbles (1-4 based on messages per turn)
  // Round to nearest integer for accurate reflection of conversation shape
  const bubbleCount = Math.max(1, Math.min(4, Math.round(avgPerTurn)));

  // Calculate base width based on avg word count (60-200px range)
  const minWidth = 60;
  const maxWidth = 200;
  const baseWidth = Math.min(maxWidth, Math.max(minWidth, 40 + avgLength * 10));

  // Height constants
  const singleLineHeight = 26;
  const doubleLineHeight = 50;
  const writesLong = avgLength >= 10;

  // Predefined width multipliers for natural-looking variance
  const widthPatterns = {
    1: [[1.0]],
    2: [
      [1.0, 0.65],
      [0.85, 1.0],
      [1.0, 0.75],
    ],
    3: [
      [1.0, 0.7, 0.85],
      [0.9, 1.0, 0.6],
      [0.75, 0.95, 0.55],
      [1.0, 0.55, 0.8],
    ],
    4: [
      [1.0, 0.6, 0.85, 0.5],
      [0.9, 0.55, 1.0, 0.7],
      [0.8, 1.0, 0.5, 0.65],
    ],
  };

  // Pick random width pattern
  const widthPatternOptions = widthPatterns[bubbleCount];
  const widthPattern =
    widthPatternOptions[Math.floor(Math.random() * widthPatternOptions.length)];

  // Generate bubbles with appropriate heights
  // For long-message writers with multiple bubbles: first bubble tall, rest single-line
  // This reflects the pattern of one main message + quick follow-ups
  const bubbles = [];
  for (let i = 0; i < bubbleCount; i++) {
    const width = Math.round(
      Math.max(minWidth, Math.min(maxWidth, baseWidth * widthPattern[i]))
    );
    // First bubble gets tall height if they write long, others are single-line follow-ups
    const height =
      writesLong && (bubbleCount === 1 || i === 0)
        ? doubleLineHeight
        : singleLineHeight;
    const borderRadius = Math.min(height / 2, 16);
    bubbles.push(
      `<div class="message-bubble ${direction}" style="width: ${width}px; height: ${height}px; border-radius: ${borderRadius}px"></div>`
    );
  }

  return bubbles.join("");
}

// Generate narrative text comparing message styles
function generateStyleNarrative(sentMetrics, receivedMetrics, firstName) {
  const youLength = sentMetrics.avg_length || 0;
  const themLength = receivedMetrics.avg_length || 0;
  const youPerTurn = sentMetrics.avg_per_turn || 1;
  const themPerTurn = receivedMetrics.avg_per_turn || 1;

  const parts = [];

  // Compare message lengths
  const lengthDiff = youLength - themLength;
  const absDiff = Math.abs(lengthDiff);
  const pctDiff = absDiff / Math.max(youLength, themLength);

  // Describe length difference in human terms (threshold: 15% AND 2+ words)
  if (pctDiff > 0.15 && absDiff > 2) {
    const ratio =
      Math.max(youLength, themLength) / Math.min(youLength, themLength);
    if (lengthDiff > 0) {
      if (ratio > 1.5) {
        parts.push(
          `<span class="you">You</span> tend to write much longer messages`
        );
      } else {
        parts.push(
          `<span class="you">You</span> tend to write longer messages`
        );
      }
    } else {
      if (ratio > 1.5) {
        parts.push(
          `<span class="them">${firstName}</span> tends to write much longer messages`
        );
      } else {
        parts.push(
          `<span class="them">${firstName}</span> tends to write longer messages`
        );
      }
    }
  } else {
    parts.push(`You both send similar length messages`);
  }

  // Describe burst behavior in human terms
  const turnDiff = Math.abs(youPerTurn - themPerTurn);

  if (turnDiff > 0.4 && (youPerTurn > 1.8 || themPerTurn > 1.8)) {
    if (youPerTurn > themPerTurn) {
      parts.push(
        `<span class="you">you</span> tend to rapid-fire multiple messages in a row`
      );
    } else {
      parts.push(
        `<span class="them">${firstName}</span> tends to send multiple messages in a row`
      );
    }
  } else if (youPerTurn > 2.2 && themPerTurn > 2.2) {
    parts.push(`you both tend to send messages in quick bursts`);
  }

  return parts.join("; ") + (parts.length > 0 ? "." : "");
}

// Render links shared card
function renderLinks(linksData, contactName, year = "all") {
  const sentCountEl = document.getElementById("links-sent");
  const receivedCountEl = document.getElementById("links-received");
  const topDomainsEl = document.getElementById("top-domains");

  // Get data for selected year (fall back to "all" if year doesn't exist)
  const yearData = linksData[year] || linksData.all || {};

  // Store current links data for the "View all" dialog
  currentLinksData = yearData;
  const sentTotal = yearData.sent?.total || 0;
  const receivedTotal = yearData.received?.total || 0;

  // Update counts
  sentCountEl.textContent = formatNumber(sentTotal);
  receivedCountEl.textContent = formatNumber(receivedTotal);

  // Combine and sort domains from sent and received
  const domainCounts = new Map();

  // Add sent domains
  for (const d of yearData.sent?.top_domains || []) {
    domainCounts.set(d.domain, {
      sent: d.count,
      received: domainCounts.get(d.domain)?.received || 0,
    });
  }

  // Add/merge received domains
  for (const d of yearData.received?.top_domains || []) {
    const existing = domainCounts.get(d.domain) || { sent: 0, received: 0 };
    domainCounts.set(d.domain, {
      sent: existing.sent,
      received: d.count,
    });
  }

  // Sort by total count and take top 6
  const sortedDomains = Array.from(domainCounts.entries())
    .map(([domain, counts]) => ({
      domain,
      sent: counts.sent,
      received: counts.received,
      total: counts.sent + counts.received,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);

  // Render domain tags
  if (sortedDomains.length > 0) {
    topDomainsEl.innerHTML = sortedDomains
      .map((d) => {
        // Determine tag color based on who shared more
        let colorClass = "";
        if (d.sent > d.received) colorClass = "sent-domain";
        else if (d.received > d.sent) colorClass = "received-domain";

        return `<span class="domain-tag ${colorClass}">${d.domain} <span class="domain-count">${d.total}</span></span>`;
      })
      .join("");
  } else {
    topDomainsEl.innerHTML = '<span class="no-domains">No links shared</span>';
  }
}

// Render keywords/topics card
function renderKeywords(keywordsData, contactName, year = "all") {
  const sentEl = document.getElementById("keywords-sent");
  const receivedEl = document.getElementById("keywords-received");

  // Get keywords for selected year, fall back to 'all' if year not available
  const yearData = keywordsData[year] || keywordsData.all || {};
  const sentTopics = yearData.sent || [];
  const receivedTopics = yearData.received || [];

  // Helper to get display text (handles both old 'keyword' and new 'label' format)
  const getLabel = (item) => item.label || item.keyword || "";

  // Render sent topics (top 6 for longer labels)
  if (sentTopics.length > 0) {
    sentEl.innerHTML = sentTopics
      .slice(0, 6)
      .map(
        (k) => `<span class="keyword-tag sent-keyword">${getLabel(k)}</span>`
      )
      .join("");
  } else {
    sentEl.innerHTML = '<span class="no-keywords">No topics found</span>';
  }

  // Render received topics (top 6 for longer labels)
  if (receivedTopics.length > 0) {
    receivedEl.innerHTML = receivedTopics
      .slice(0, 6)
      .map(
        (k) =>
          `<span class="keyword-tag received-keyword">${getLabel(k)}</span>`
      )
      .join("");
  } else {
    receivedEl.innerHTML = '<span class="no-keywords">No topics found</span>';
  }
}

// Helper to ensure emoji characters render as colorful emoji (not text glyphs)
function ensureEmojiPresentation(emoji) {
  if (
    emoji.length >= 1 &&
    EMOJI_NEEDS_VS.includes(emoji[0]) &&
    !emoji.includes("\uFE0F")
  ) {
    return emoji[0] + "\uFE0F" + emoji.slice(1);
  }
  return emoji;
}

// Render emoji card for per-contact view
function renderEmoji(emojiData, contactName, year = "all") {
  const sentEl = document.getElementById("emoji-sent");
  const receivedEl = document.getElementById("emoji-received");
  const sentCountEl = document.getElementById("emoji-sent-count");
  const receivedCountEl = document.getElementById("emoji-received-count");

  // Get data for selected year (fall back to "all" if year doesn't exist)
  const yearData = emojiData[year] || emojiData.all || {};
  const sentEmoji = yearData.sent?.top || [];
  const receivedEmoji = yearData.received?.top || [];
  const sentTotal = yearData.sent?.total || 0;
  const receivedTotal = yearData.received?.total || 0;

  // Update total counts in header
  sentCountEl.textContent = formatNumber(sentTotal);
  receivedCountEl.textContent = formatNumber(receivedTotal);

  // Render sent emojis (top 5)
  if (sentEmoji.length > 0) {
    sentEl.innerHTML = sentEmoji
      .slice(0, 5)
      .map(
        (e) =>
          `<span class="emoji-item sent-emoji"><span class="emoji">${ensureEmojiPresentation(
            e.emoji
          )}</span><span class="count">${formatNumber(e.count)}</span></span>`
      )
      .join("");
  } else {
    sentEl.innerHTML = '<span class="no-emoji">No emojis</span>';
  }

  // Render received emojis (top 5)
  if (receivedEmoji.length > 0) {
    receivedEl.innerHTML = receivedEmoji
      .slice(0, 5)
      .map(
        (e) =>
          `<span class="emoji-item received-emoji"><span class="emoji">${ensureEmojiPresentation(
            e.emoji
          )}</span><span class="count">${formatNumber(e.count)}</span></span>`
      )
      .join("");
  } else {
    receivedEl.innerHTML = '<span class="no-emoji">No emojis</span>';
  }
}

// Render global emoji section for Everyone view
function renderGlobalEmoji(emojiData) {
  const section = document.getElementById("global-emoji-section");
  const grid = document.getElementById("global-emoji");

  if (!emojiData || !emojiData.top || emojiData.top.length === 0) {
    section.style.display = "none";
    return;
  }

  // Show top 5 emojis
  const topEmoji = emojiData.top.slice(0, 5);
  grid.innerHTML = topEmoji
    .map(
      (e) =>
        `<div class="global-emoji-item"><span class="emoji">${ensureEmojiPresentation(
          e.emoji
        )}</span><span class="count">${formatNumber(e.count)}</span></div>`
    )
    .join("");

  section.style.display = "block";
}

// Render LLM themes card
function renderLlmThemes(themesData, year = "all") {
  const tagsEl = document.getElementById("theme-tags");
  const summaryEl = document.getElementById("theme-summary");
  const evolutionEl = document.getElementById("theme-evolution");

  // Get data for selected year (fall back to "all" if year doesn't exist)
  // Handle both new format ({"all": {...}, "2024": {...}}) and legacy format ({themes: [...], summary: "..."})
  let yearData;
  if (themesData.all || themesData[year]) {
    // New per-year format
    yearData = themesData[year] || themesData.all || {};
  } else {
    // Legacy format - themesData is the data itself
    yearData = themesData;
  }

  const themes = yearData.themes || [];
  const summary = yearData.summary || "";

  // Render theme tags
  if (themes.length > 0) {
    tagsEl.innerHTML = themes
      .map((theme) => `<span class="theme-tag">${theme}</span>`)
      .join("");
  } else {
    tagsEl.innerHTML = "";
  }

  // Render summary
  summaryEl.textContent = summary;

  // Render evolution (only when viewing "all" time and evolution data exists)
  const evolution = themesData.evolution;
  if (year === "all" && evolution) {
    evolutionEl.textContent = evolution;
    evolutionEl.style.display = "block";
  } else {
    evolutionEl.style.display = "none";
  }
}

// Render attachment details under sent/received stats
function renderAttachmentDetails(att, links) {
  if (!att) {
    statTotalDetail.innerHTML = "";
    statSentDetail.innerHTML = "";
    statReceivedDetail.innerHTML = "";
    return;
  }

  // Use \u00A0 (non-breaking space) to keep number and unit together
  const nbsp = "\u00A0";

  // Build total details
  const totalParts = [];
  const totalPhotos = (att.photos_sent || 0) + (att.photos_received || 0);
  const totalVideos = (att.videos_sent || 0) + (att.videos_received || 0);
  const totalAudio = (att.audio_sent || 0) + (att.audio_received || 0);
  const totalGifs = (att.gifs_sent || 0) + (att.gifs_received || 0);
  const totalLinks = (links?.links_sent || 0) + (links?.links_received || 0);
  if (totalPhotos)
    totalParts.push(
      `${formatNumber(totalPhotos)}${nbsp}photo${totalPhotos === 1 ? "" : "s"}`
    );
  if (totalVideos)
    totalParts.push(
      `${formatNumber(totalVideos)}${nbsp}video${totalVideos === 1 ? "" : "s"}`
    );
  if (totalAudio) totalParts.push(`${formatNumber(totalAudio)}${nbsp}audio`);
  if (totalGifs)
    totalParts.push(
      `${formatNumber(totalGifs)}${nbsp}GIF${totalGifs === 1 ? "" : "s"}`
    );
  if (totalLinks)
    totalParts.push(
      `${formatNumber(totalLinks)}${nbsp}link${totalLinks === 1 ? "" : "s"}`
    );
  statTotalDetail.innerHTML = totalParts
    .map(
      (p, i) =>
        `<span class="detail-line">${i === 0 ? "└── " : "    "}${p}</span>`
    )
    .join("");

  // Build sent details
  const sentParts = [];
  if (att.photos_sent)
    sentParts.push(
      `${formatNumber(att.photos_sent)}${nbsp}photo${
        att.photos_sent === 1 ? "" : "s"
      }`
    );
  if (att.videos_sent)
    sentParts.push(
      `${formatNumber(att.videos_sent)}${nbsp}video${
        att.videos_sent === 1 ? "" : "s"
      }`
    );
  if (att.audio_sent)
    sentParts.push(`${formatNumber(att.audio_sent)}${nbsp}audio`);
  if (att.gifs_sent)
    sentParts.push(
      `${formatNumber(att.gifs_sent)}${nbsp}GIF${
        att.gifs_sent === 1 ? "" : "s"
      }`
    );
  if (links?.links_sent)
    sentParts.push(
      `${formatNumber(links.links_sent)}${nbsp}link${
        links.links_sent === 1 ? "" : "s"
      }`
    );
  statSentDetail.innerHTML = sentParts
    .map(
      (p, i) =>
        `<span class="detail-line">${i === 0 ? "└── " : "    "}${p}</span>`
    )
    .join("");

  // Build received details
  const recvParts = [];
  if (att.photos_received)
    recvParts.push(
      `${formatNumber(att.photos_received)}${nbsp}photo${
        att.photos_received === 1 ? "" : "s"
      }`
    );
  if (att.videos_received)
    recvParts.push(
      `${formatNumber(att.videos_received)}${nbsp}video${
        att.videos_received === 1 ? "" : "s"
      }`
    );
  if (att.audio_received)
    recvParts.push(`${formatNumber(att.audio_received)}${nbsp}audio`);
  if (att.gifs_received)
    recvParts.push(
      `${formatNumber(att.gifs_received)}${nbsp}GIF${
        att.gifs_received === 1 ? "" : "s"
      }`
    );
  if (links?.links_received)
    recvParts.push(
      `${formatNumber(links.links_received)}${nbsp}link${
        links.links_received === 1 ? "" : "s"
      }`
    );
  statReceivedDetail.innerHTML = recvParts
    .map(
      (p, i) =>
        `<span class="detail-line">${i === 0 ? "└── " : "    "}${p}</span>`
    )
    .join("");
}

// Get time-of-day period for an hour
function getTimePeriod(hour) {
  if (hour >= 5 && hour < 12) return "mornings";
  if (hour >= 12 && hour < 17) return "afternoons";
  if (hour >= 17 && hour < 21) return "evenings";
  return "nights"; // 21-23, 0-4
}

// Render time heatmap
function renderHeatmap(heatmap, yearFilter = "all") {
  if (!heatmap || !heatmapCanvas) return;

  currentHeatmapData = heatmap;

  const ctx = heatmapCanvas.getContext("2d");
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
    const [dayIdx, period] = peakKey.split("-");
    const dayName = dayNames[parseInt(dayIdx)];
    heatmapLabel.textContent = `You usually text on ${dayName} ${period}`;
  } else {
    heatmapLabel.textContent = "";
  }

  // Draw cells
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const value = heatmap[day]?.[hour] || 0;
      const intensity = max > 0 ? value / max : 0;

      // Green with varying opacity
      const alpha = 0.08 + intensity * 0.92;
      ctx.fillStyle = `rgba(76, 175, 80, ${alpha})`;

      const x = hour * cellWidth;
      const y = day * cellHeight;
      ctx.fillRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
    }
  }
}

// Heatmap hover handlers
heatmapCanvas.addEventListener("mousemove", (e) => {
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

    heatmapTooltip.textContent = `${dayName} ${timeRange}: ${count} message${
      count === 1 ? "" : "s"
    }`;
    heatmapTooltip.classList.add("visible");

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

heatmapCanvas.addEventListener("mouseleave", () => {
  heatmapTooltip.classList.remove("visible");
});

// Scroll listener for sticky year filter border
contentEl.addEventListener("scroll", () => {
  const isScrolled = contentEl.scrollTop > 10;
  if (yearFilterSection.style.display !== "none") {
    yearFilterSection.classList.toggle("scrolled", isScrolled);
  }
  if (contactYearFilterSection.style.display !== "none") {
    contactYearFilterSection.classList.toggle("scrolled", isScrolled);
  }
});

// Render the chart based on current view
function renderChart(monthlyData) {
  // Use provided monthly data or fall back to full data
  const currentMonthlyData =
    monthlyData || (currentContactData && currentContactData.monthly);
  if (!currentMonthlyData) return;

  const ctx = document.getElementById("chart").getContext("2d");

  // Destroy existing chart
  if (chart) {
    chart.destroy();
  }

  let data, labels, tooltipFormat;

  // Track which indices are year starts (for styling)
  let yearStartIndices = new Set();

  if (currentView === "year") {
    const yearly = aggregateToYearly(currentMonthlyData);
    data = yearly;
    labels = yearly.map((y) => y.year);
    tooltipFormat = (item) => item.year;
  } else {
    data = currentMonthlyData;
    labels = currentMonthlyData.map((m, i) => {
      const [year, month] = m.month.split("-");
      const date = new Date(year, month - 1);
      // Show year on January or first item
      if (month === "01" || i === 0) {
        yearStartIndices.add(i);
        return date.toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
        });
      }
      return date.toLocaleDateString("en-US", { month: "short" });
    });
    tooltipFormat = (item) => {
      const [year, month] = item.month.split("-");
      return new Date(year, month - 1).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
      });
    };
  }

  chart = new Chart(ctx, {
    type: "bar",
    plugins: [hoverHighlightPlugin],
    data: {
      labels,
      datasets: [
        {
          label: "sent",
          data: data.map((d) => d.sent),
          backgroundColor: colors.sent,
          borderRadius: 2,
          barPercentage: 0.7,
          categoryPercentage: 0.8,
        },
        {
          label: "recv",
          data: data.map((d) => d.received),
          backgroundColor: colors.received,
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
        mode: "index",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          position: "fixedTop",
          yAlign: "top",
          caretSize: 0,
          backgroundColor: "#1a1a1a",
          titleColor: "#999",
          bodyColor: "#ccc",
          borderColor: "#333",
          borderWidth: 1,
          padding: 12,
          titleFont: { family: "SF Mono, Monaco, monospace", size: 11 },
          bodyFont: { family: "SF Mono, Monaco, monospace", size: 12 },
          displayColors: true,
          usePointStyle: true,
          boxWidth: 8,
          boxHeight: 8,
          boxPadding: 4,
          callbacks: {
            title: (items) => {
              const idx = items[0].dataIndex;
              return tooltipFormat(data[idx]);
            },
            label: (ctx) => ` ${ctx.dataset.label}: ${formatNumber(ctx.raw)}`,
            labelPointStyle: () => "rect",
            labelColor: (ctx) => ({
              backgroundColor: ctx.dataset.backgroundColor,
              borderColor: ctx.dataset.backgroundColor,
              borderWidth: 0,
            }),
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
          border: { color: "#333" },
          ticks: {
            autoSkip: false,
            maxRotation: 45,
            minRotation: 45,
            callback: function (value, index) {
              // For single year filter, show all month labels
              if (isEveryoneView && currentYearFilter !== "all") {
                return this.getLabelForValue(value);
              }
              if (!isEveryoneView && currentContactYearFilter !== "all") {
                return this.getLabelForValue(value);
              }

              // In year view, show all labels
              if (currentView === "year") return this.getLabelForValue(value);

              // In month view, only show January with year
              if (yearStartIndices.has(index)) {
                return this.getLabelForValue(value);
              }

              return null;
            },
            color: "#999",
            font: {
              family: "SF Mono, Monaco, monospace",
              size: 12,
              weight: "bold",
            },
          },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: "#1a1a1a" },
          border: { display: false },
          ticks: {
            color: "#555",
            font: { family: "SF Mono, Monaco, monospace", size: 10 },
            callback: (v) => formatNumber(v),
          },
        },
      },
    },
  });
}

// Render year filter buttons
function renderYearFilter(years) {
  yearFilterGrid.innerHTML =
    '<button data-year="all" class="active">All time</button>' +
    years.map((y) => `<button data-year="${y}">${y}</button>`).join("");
}

// Update active state on year filter buttons
function updateYearFilterActive(year) {
  yearFilterGrid.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.year === year);
  });
}

// Format month as "January 2024"
function formatMonthLong(monthStr) {
  const [year, month] = monthStr.split("-");
  return new Date(year, month - 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

// Render top contacts grid
function renderTopContacts(topContacts) {
  topContactsGrid.innerHTML = topContacts
    .map(
      (c) => `
    <div class="top-contact-card" data-filename="${c.filename}">
      <div class="top-contact-rank">#${c.rank}</div>
      <div class="top-contact-name">${c.name}</div>
      <div class="top-contact-count">${formatNumber(c.total)} messages</div>
    </div>
  `
    )
    .join("");
}

// Load Everyone view
async function loadEveryone() {
  isEveryoneView = true;
  currentContactFilename = "";

  // Update URL hash (only push to history if not from popstate)
  const newHash =
    currentYearFilter === "all"
      ? "#everyone"
      : `#everyone/${currentYearFilter}`;
  if (isNavigatingFromPopState) {
    isNavigatingFromPopState = false;
  } else {
    history.pushState(null, "", newHash);
  }

  // Update active states
  everyoneTab.classList.add("active");
  document.querySelectorAll("#contact-list li").forEach((li) => {
    li.classList.remove("active");
  });

  // Reset scroll position and scrolled state
  yearFilterSection.classList.remove("scrolled");
  contentEl.scrollTop = 0;

  // Show/hide appropriate sections
  welcome.style.display = "none";
  document.getElementById("contact-header").style.display = "flex";
  chartContainer.style.display = "block";
  yearFilterSection.style.display = "block";
  contactYearFilterSection.style.display = "none"; // Hide contact year filter
  patternsSection.style.display = "none"; // No response stats for global
  analysisSection.style.display = "none"; // No analysis for global view

  // Fetch everyone data if not loaded
  if (!everyoneData) {
    try {
      const response = await fetch("data/everyone.json");
      everyoneData = await response.json();
      renderYearFilter(everyoneData.years);
      everyoneTotal.textContent = `${formatNumber(
        everyoneData.total_sent + everyoneData.total_received
      )} messages`;
    } catch (err) {
      console.error("Failed to load everyone data:", err);
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

  if (year === "all") {
    sent = everyoneData.total_sent;
    received = everyoneData.total_received;
    firstDate = null; // Don't show "texting since" on aggregation view
    monthly = everyoneData.monthly;
    heatmap = everyoneData.time_heatmap;
    data = everyoneData;

    // Show all-time top contacts
    if (everyoneData.top_contacts && everyoneData.top_contacts.length > 0) {
      let displayContacts = everyoneData.top_contacts;
      if (FAKE_MODE) {
        displayContacts = everyoneData.top_contacts.map((c, i) => ({
          ...c,
          name: fakeNames[i] || c.name,
        }));
      }
      topContactsYear.textContent = "all time";
      renderTopContacts(displayContacts);
      topContactsSection.style.display = "block";
    } else {
      topContactsSection.style.display = "none";
    }

    busiestMonthSection.style.display = "none";

    // Show month/year toggle for all-time view
    chartToggle.style.display = "flex";
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
          name: fakeNames[i] || c.name,
        }));
      }
      topContactsYear.textContent = year;
      renderTopContacts(displayContacts);
      topContactsSection.style.display = "block";
    } else {
      topContactsSection.style.display = "none";
    }

    // Show busiest month
    if (yearData.busiest_month) {
      busiestMonthEl.innerHTML = `Your busiest month was <span>${formatMonthLong(
        yearData.busiest_month.month
      )}</span> with ${formatNumber(yearData.busiest_month.total)} messages`;
      busiestMonthSection.style.display = "block";
    } else {
      busiestMonthSection.style.display = "none";
    }

    // Hide month/year toggle for single year (only month view makes sense)
    chartToggle.style.display = "none";
    // Reset to month view if currently on year view
    if (currentView === "year") {
      currentView = "month";
      toggleButtons.forEach((b) =>
        b.classList.toggle("active", b.dataset.view === "month")
      );
    }
  }

  // Update header
  contactNameEl.textContent = "iMessage Stats";
  const sinceEl = document.getElementById("texting-since");
  if (firstDate) {
    sinceEl.textContent = `Texting since ${formatSinceDate(firstDate)}`;
  } else {
    sinceEl.textContent = "";
  }

  // Update stats
  const total = sent + received;
  statTotal.innerHTML = `<span class="num">${formatNumber(
    total
  )}</span> messages`;
  statSent.innerHTML = `<span class="sent">${formatNumber(sent)}</span> sent`;
  statReceived.innerHTML = `<span class="received">${formatNumber(
    received
  )}</span> received`;

  // Update attachment details (including links)
  if (year === "all") {
    renderAttachmentDetails(everyoneData.attachments, everyoneData.links);
  } else {
    renderAttachmentDetails(
      everyoneData.by_year[year].attachments,
      everyoneData.by_year[year].links
    );
  }

  // Update chart and heatmap
  currentContactData = { monthly };
  renderChart();
  renderHeatmap(heatmap);

  // Render global emoji section
  if (year === "all") {
    renderGlobalEmoji(everyoneData.emoji);
  } else {
    renderGlobalEmoji(everyoneData.by_year[year].emoji);
  }
}

// Event listeners
contactList.addEventListener("click", (e) => {
  const li = e.target.closest("li");
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

searchInput.addEventListener("input", (e) => {
  renderContacts(e.target.value);
});

// Everyone tab click
everyoneTab.addEventListener("click", () => {
  currentYearFilter = "all";
  loadEveryone();
});

// Year filter button click (Everyone view)
yearFilterGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn) {
    const year = btn.dataset.year;
    const newHash = year === "all" ? "#everyone" : `#everyone/${year}`;
    history.pushState(null, "", newHash);
    loadEveryoneYear(year);
  }
});

// Contact year filter button click
contactYearFilterGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn && currentContactData) {
    const year = btn.dataset.year;
    renderContactYear(year);
    updateAnalysisCardsForYear(year);
  }
});

// Top contacts card click
topContactsGrid.addEventListener("click", (e) => {
  const card = e.target.closest(".top-contact-card");
  if (card) {
    const filename = card.dataset.filename;
    const contact = contacts.find((c) => c.filename === filename);
    if (contact) {
      loadContact(
        contact.filename,
        contact.name,
        contact.total,
        contact.sent,
        contact.received,
        contact.first_date
      );
    }
  }
});

// Analysis year filter button click - sync with main contact year filter
analysisYearFilterGrid.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (btn && currentContactData?.analysis) {
    const year = btn.dataset.year;
    updateAnalysisCardsForYear(year);
    renderContactYear(year);
  }
});

// Keyboard navigation for contacts list (includes Everyone tab)
document.addEventListener("keydown", (e) => {
  // Skip if typing in search
  if (document.activeElement === searchInput && searchInput.value) return;

  // Left/right arrows for year filter navigation on aggregate view
  if (
    (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    isEveryoneView &&
    everyoneData
  ) {
    e.preventDefault();

    // Build year options array: ['all', '2026', '2025', ...]
    const yearOptions = ["all", ...everyoneData.years];
    let currentIndex = yearOptions.indexOf(currentYearFilter);
    if (currentIndex === -1) currentIndex = 0;

    if (e.key === "ArrowLeft") {
      currentIndex =
        currentIndex > 0 ? currentIndex - 1 : yearOptions.length - 1;
    } else {
      currentIndex =
        currentIndex < yearOptions.length - 1 ? currentIndex + 1 : 0;
    }

    const newYear = yearOptions[currentIndex];
    const newHash = newYear === "all" ? "#everyone" : `#everyone/${newYear}`;
    history.pushState(null, "", newHash);
    loadEveryoneYear(newYear);

    // Focus the newly active button
    const activeBtn = yearFilterGrid.querySelector("button.active");
    if (activeBtn) activeBtn.focus();
    return;
  }

  // Left/right arrows for year filter navigation on contact view
  if (
    (e.key === "ArrowLeft" || e.key === "ArrowRight") &&
    !isEveryoneView &&
    currentContactData
  ) {
    const years = getYearsFromMonthly(currentContactData.monthly);
    if (years.length <= 1) return; // No year filter to navigate

    e.preventDefault();

    // Build year options array: ['all', '2024', '2023', ...]
    const yearOptions = ["all", ...years];
    let currentIndex = yearOptions.indexOf(currentContactYearFilter);
    if (currentIndex === -1) currentIndex = 0;

    if (e.key === "ArrowLeft") {
      currentIndex =
        currentIndex > 0 ? currentIndex - 1 : yearOptions.length - 1;
    } else {
      currentIndex =
        currentIndex < yearOptions.length - 1 ? currentIndex + 1 : 0;
    }

    const newYear = yearOptions[currentIndex];
    renderContactYear(newYear);
    updateAnalysisCardsForYear(newYear);

    // Focus the newly active button
    const activeBtn = contactYearFilterGrid.querySelector("button.active");
    if (activeBtn) activeBtn.focus();
    return;
  }

  // Up/down arrows for contact navigation
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

  e.preventDefault();

  const items = Array.from(contactList.querySelectorAll("li"));
  // Index -1 = Everyone, 0+ = contacts
  let currentIndex = isEveryoneView
    ? -1
    : items.findIndex((li) => li.classList.contains("active"));

  if (e.key === "ArrowDown") {
    if (currentIndex < items.length - 1) {
      currentIndex++;
    } else {
      currentIndex = -1; // Wrap to Everyone
    }
  } else if (e.key === "ArrowUp") {
    if (currentIndex > -1) {
      currentIndex--;
    } else {
      currentIndex = items.length - 1; // Wrap to last contact
    }
  }

  if (currentIndex === -1) {
    // Select Everyone
    currentYearFilter = "all";
    loadEveryone();
  } else {
    const targetItem = items[currentIndex];
    if (targetItem) {
      targetItem.scrollIntoView({ block: "nearest" });
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
toggleButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    toggleButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentView = btn.dataset.view;

    // Get the appropriate monthly data for current view
    if (!isEveryoneView && currentContactData) {
      const filteredMonthly = filterMonthlyByYear(
        currentContactData.monthly,
        currentContactYearFilter
      );
      renderChart(filteredMonthly);
    } else {
      renderChart();
    }
  });
});

// Handle browser back/forward navigation
window.addEventListener("popstate", () => {
  const hash = window.location.hash.slice(1);
  isNavigatingFromPopState = true;

  if (hash === "everyone" || hash === "") {
    currentYearFilter = "all";
    loadEveryone();
  } else if (hash.startsWith("everyone/")) {
    const year = hash.split("/")[1];
    if (everyoneData && everyoneData.years.includes(year)) {
      currentYearFilter = year;
    } else {
      currentYearFilter = "all";
    }
    loadEveryone();
  } else {
    // Contact view
    const contact = contacts.find((c) => c.filename === hash);
    if (contact) {
      loadContact(
        contact.filename,
        contact.name,
        contact.total,
        contact.sent,
        contact.received,
        contact.first_date
      );
    } else {
      currentYearFilter = "all";
      loadEveryone();
    }
  }
});

// Screenshot functionality
async function takeScreenshot() {
  const content = document.querySelector(".content");
  const screenshotBtn = document.getElementById("screenshot-btn");

  // Hide button during capture (so it doesn't appear in screenshot)
  // Use visibility to avoid layout shift
  screenshotBtn.style.visibility = "hidden";

  // Store original styles
  const originalOverflow = content.style.overflow;
  const originalHeight = content.style.height;

  // Expand to full content height for full-page capture
  content.style.overflow = "visible";
  content.style.height = "auto";

  try {
    const canvas = await html2canvas(content, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#0a0a0a",
    });

    showScreenshotDialog(canvas.toDataURL("image/png"));
  } finally {
    // Restore original styles
    content.style.overflow = originalOverflow;
    content.style.height = originalHeight;
    screenshotBtn.style.visibility = "";
  }
}

function showScreenshotDialog(dataUrl) {
  const dialog = document.getElementById("screenshot-dialog");
  const preview = document.getElementById("screenshot-preview");
  preview.src = dataUrl;
  dialog.showModal();
}

function downloadScreenshot() {
  const preview = document.getElementById("screenshot-preview");
  const link = document.createElement("a");
  const name = currentContactName || "everyone";
  link.download = `imessage-stats-${name
    .toLowerCase()
    .replace(/\s+/g, "-")}.png`;
  link.href = preview.src;
  link.click();
}

async function copyScreenshot() {
  const preview = document.getElementById("screenshot-preview");
  const copyBtn = document.getElementById("copy-screenshot");

  try {
    const response = await fetch(preview.src);
    const blob = await response.blob();
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);

    copyBtn.textContent = "Copied!";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1500);
  } catch (err) {
    console.error("Failed to copy:", err);
    copyBtn.textContent = "Failed";
    setTimeout(() => {
      copyBtn.textContent = "Copy";
    }, 1500);
  }
}

document
  .getElementById("screenshot-btn")
  .addEventListener("click", takeScreenshot);
document
  .getElementById("copy-screenshot")
  .addEventListener("click", copyScreenshot);
document
  .getElementById("download-screenshot")
  .addEventListener("click", downloadScreenshot);
document.getElementById("dialog-close").addEventListener("click", () => {
  document.getElementById("screenshot-dialog").close();
});

// Close dialog when clicking on backdrop
document.getElementById("screenshot-dialog").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.close();
  }
});

// Links dialog functionality
let allLinksForSearch = [];
let currentLinksFilter = "all";
const linksSearchInput = document.getElementById("links-search");
const linksFilterBtns = document.querySelectorAll(".links-filter-btn");

function updateFilterButtonStates() {
  linksFilterBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.filter === currentLinksFilter);
  });
}

function formatLinkUrl(url) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return "https://" + url;
  }
  return url;
}

function formatDisplayUrl(url) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "");
}

function renderLinksList(links) {
  if (links.length === 0) {
    linksList.innerHTML = '<li class="links-no-results">No links found</li>';
    return;
  }

  linksList.innerHTML = links
    .map(
      ({ url, direction }) => `
    <li>
      <a href="${formatLinkUrl(
        url
      )}" target="_blank" rel="noopener noreferrer" class="link-item" title="${url}">
        <span class="link-indicator ${direction}"></span>
        <span class="link-url">${formatDisplayUrl(url)}</span>
      </a>
    </li>
  `
    )
    .join("");
}

function getFilteredLinks() {
  let links = allLinksForSearch;

  // Apply direction filter
  if (currentLinksFilter !== "all") {
    links = links.filter(({ direction }) => direction === currentLinksFilter);
  }

  // Apply search filter
  const query = linksSearchInput.value.toLowerCase().trim();
  if (query) {
    links = links.filter(({ url }) => url.toLowerCase().includes(query));
  }

  return links;
}

function updateLinksDisplay() {
  const filtered = getFilteredLinks();
  if (allLinksForSearch.length === 0) {
    linksList.innerHTML = '<li class="links-empty">No links shared</li>';
  } else {
    renderLinksList(filtered);
  }
}

function showLinksDialog() {
  if (!currentLinksData) return;

  const sentUrls = currentLinksData.sent?.urls || [];
  const receivedUrls = currentLinksData.received?.urls || [];

  // Combine and store for search
  allLinksForSearch = [
    ...sentUrls.map((url) => ({ url, direction: "sent" })),
    ...receivedUrls.map((url) => ({ url, direction: "received" })),
  ];

  // Reset filter to 'all' and clear search
  currentLinksFilter = "all";
  linksSearchInput.value = "";
  updateFilterButtonStates();
  updateLinksDisplay();

  linksDialog.showModal();

  // Focus search input after dialog opens
  setTimeout(() => linksSearchInput.focus(), 50);
}

// Search links
linksSearchInput.addEventListener("input", () => {
  updateLinksDisplay();
});

// Filter links by direction
linksFilterBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLinksFilter = btn.dataset.filter;
    updateFilterButtonStates();
    updateLinksDisplay();
  });
});

viewAllLinksBtn.addEventListener("click", showLinksDialog);

document.getElementById("links-dialog-close").addEventListener("click", () => {
  linksDialog.close();
});

// Close links dialog when clicking on backdrop
linksDialog.addEventListener("click", (e) => {
  if (e.target === e.currentTarget) {
    e.currentTarget.close();
  }
});

// LLM Status Polling Functions
async function checkLlmStatus() {
  try {
    const response = await fetch("data/_llm_status.json", {
      cache: "no-store",
    });
    if (response.ok) {
      llmStatus = await response.json();
      return true;
    } else if (response.status === 404) {
      // Status file doesn't exist - either LLM is complete or not running
      llmStatus = null;
      return false;
    }
  } catch (e) {
    llmStatus = null;
    return false;
  }
  return false;
}

function isContactPending(filename) {
  return llmStatus && llmStatus.pending && llmStatus.pending.includes(filename);
}

function startLlmPolling() {
  if (llmPollingInterval) return; // Already polling

  let previousPendingCount = llmStatus ? llmStatus.pending.length : 0;

  llmPollingInterval = setInterval(async () => {
    const wasPolling = llmStatus !== null;
    const stillRunning = await checkLlmStatus();
    const currentPendingCount = llmStatus ? llmStatus.pending.length : 0;

    // Re-render sidebar if pending count changed (contacts completed)
    if (currentPendingCount !== previousPendingCount) {
      renderContacts(searchInput.value);
      previousPendingCount = currentPendingCount;
    }

    if (!stillRunning && wasPolling) {
      // LLM just finished - reload current contact if viewing one
      stopLlmPolling();
      renderContacts(searchInput.value); // Final refresh to clear all "Processing..."
      if (!isEveryoneView && currentContactFilename) {
        reloadCurrentContact();
      }
    } else if (
      stillRunning &&
      currentContactFilename &&
      !isContactPending(currentContactFilename)
    ) {
      // Current contact just completed - reload it
      reloadCurrentContact();
    }
  }, 2000); // Poll every 2 seconds
}

function stopLlmPolling() {
  if (llmPollingInterval) {
    clearInterval(llmPollingInterval);
    llmPollingInterval = null;
  }
}

async function reloadCurrentContact() {
  if (!currentContactFilename) return;

  try {
    const response = await fetch(
      `data/messages/${currentContactFilename}.json`,
      { cache: "no-store" }
    );
    if (response.ok) {
      const newData = await response.json();
      currentContactData = newData;

      // Re-render analysis section to show new themes
      if (newData.analysis) {
        renderAnalysis(newData.analysis, currentContactName);
      }
    }
  } catch (e) {
    console.error("Failed to reload contact data:", e);
  }
}

// Initialize
async function init() {
  try {
    // Load contacts, everyone data, and check LLM status in parallel
    const [contactsResponse, everyoneResponse] = await Promise.all([
      fetch("data/contacts.json"),
      fetch("data/everyone.json"),
      checkLlmStatus(),
    ]);

    contacts = await contactsResponse.json();
    everyoneData = await everyoneResponse.json();

    // Start polling if LLM analysis is still running
    if (llmStatus) {
      startLlmPolling();
    }

    // Apply fake names for screenshots
    if (FAKE_MODE) {
      contacts.forEach((c, i) => {
        if (fakeNames[i]) c.name = fakeNames[i];
      });
    }

    renderContacts();

    // Update Everyone tab with total
    everyoneTotal.textContent = `${formatNumber(
      everyoneData.total_sent + everyoneData.total_received
    )} messages`;
    renderYearFilter(everyoneData.years);

    // Restore selection from URL hash (don't push to history on initial load)
    const hash = window.location.hash.slice(1);
    isNavigatingFromPopState = true;

    if (hash === "everyone" || hash === "") {
      // Default to Everyone view
      loadEveryone();
    } else if (hash.startsWith("everyone/")) {
      // Everyone view with year filter
      const year = hash.split("/")[1];
      if (everyoneData.years.includes(year)) {
        currentYearFilter = year;
      }
      loadEveryone();
    } else {
      // Contact view
      const contact = contacts.find((c) => c.filename === hash);
      if (contact) {
        loadContact(
          contact.filename,
          contact.name,
          contact.total,
          contact.sent,
          contact.received,
          contact.first_date
        );
        // Scroll the contact into view in the sidebar
        const activeItem = contactList.querySelector("li.active");
        if (activeItem) {
          activeItem.scrollIntoView({ block: "nearest" });
        }
      } else {
        // Invalid hash, default to Everyone
        loadEveryone();
      }
    }
  } catch (err) {
    console.error("Failed to load data:", err);
    contactList.innerHTML = "<li>run ./scripts/start first</li>";
  }
}

init();
