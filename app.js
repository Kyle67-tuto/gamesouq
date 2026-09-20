// ==========================================================================
// GameSouq (جيم سوق) — app.js
// Firebase modular SDK loaded straight from the gstatic CDN (no bundler
// required). Deploy these files as-is on Firebase Hosting or any static host.
// ==========================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAnalytics, isSupported as analyticsSupported } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-analytics.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  addDoc, query, where, orderBy, limit, onSnapshot, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// --------------------------------------------------------------------------
// CONFIG
// --------------------------------------------------------------------------
const firebaseConfig = {
  apiKey: "AIzaSyB9Z5Tjc0yWg69GlWdUBTZ9VgUcGrh5mMU",
  authDomain: "v-scans.firebaseapp.com",
  projectId: "v-scans",
  storageBucket: "v-scans.firebasestorage.app",
  messagingSenderId: "545198752043",
  appId: "1:545198752043:web:efdc1656b5fd4f354ec56e",
  measurementId: "G-NDQER8NPM9"
};
const IMGBB_API_KEY = "bf32151ce65f47f2707753b98cfa9b67";
const MAIN_ADMIN_EMAIL = "anwarbah69@gmail.com";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
analyticsSupported().then((ok) => { if (ok) getAnalytics(app); }).catch(() => {});

// --------------------------------------------------------------------------
// STATE
// --------------------------------------------------------------------------
let currentUser = null;      // firebase auth user
let currentUserDoc = null;   // /users/{uid} data
let categories = [];         // [{id,name}]
let activeCategory = "all";
let offersUnsub = null;
let chatUnsubMsgs = null;
let chatUnsubDoc = null;
let activeChat = null;       // {id, ...data}
let activeOfferForChat = null;
let pendingRatingQueue = []; // [{targetId, targetLabel}]
let selectedStars = 0;
let offerImageFiles = [];

// --------------------------------------------------------------------------
// DOM HELPERS
// --------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg) {
  const inner = $("#toastInner");
  inner.textContent = msg;
  inner.style.opacity = "1";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { inner.style.opacity = "0"; }, 2600);
}

function esc(str) {
  return (str || "").toString().replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "الآن";
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} يوم`;
}

function stars(avg) {
  const full = Math.round(avg || 0);
  return "★".repeat(full) + "☆".repeat(5 - full);
}

// --------------------------------------------------------------------------
// THEME
// --------------------------------------------------------------------------
function initTheme() {
  const saved = localStorage.getItem("gs-theme") || "dark";
  document.documentElement.setAttribute("data-theme", saved);
}
$("#btnThemeToggle").addEventListener("click", () => {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("gs-theme", next);
});
initTheme();

// --------------------------------------------------------------------------
// NAVIGATION
// --------------------------------------------------------------------------
function goTo(viewName) {
  $$(".view").forEach((v) => v.classList.add("hidden"));
  const el = $(`#view-${viewName}`);
  if (el) el.classList.remove("hidden");
  $$(".tab-item").forEach((b) => {
    b.classList.toggle("tab-active", b.dataset.nav === viewName);
  });
  closeMenu();
  if (viewName === "profile") renderProfileView();
  if (viewName === "admin") { guardAdminView(); renderAdminView(); }
  if (viewName === "mmRequests") loadMiddlemanRequests();
  window.scrollTo({ top: 0 });
}
$$("[data-nav]").forEach((b) => b.addEventListener("click", () => goTo(b.dataset.nav)));
$("#btnLogoHome").addEventListener("click", () => goTo("feed"));

function openMenu() {
  $("#menuOverlay").classList.remove("hidden");
  requestAnimationFrame(() => $("#menuDrawer").classList.add("open"));
}
function closeMenu() {
  $("#menuDrawer").classList.remove("open");
  setTimeout(() => $("#menuOverlay").classList.add("hidden"), 200);
}
$("#btnOpenMenu").addEventListener("click", openMenu);
$("#btnCloseMenu").addEventListener("click", closeMenu);
$("#menuOverlay").addEventListener("click", closeMenu);

// --------------------------------------------------------------------------
// AUTH
// --------------------------------------------------------------------------
function renderAuthUI() {
  const authArea = $("#authArea");
  const authBtn = $("#btnAuthAction");
  const menuProfile = $("#menuProfile");

  if (currentUser) {
    authArea.innerHTML = `<img src="${esc(currentUser.photoURL || "")}" class="w-8 h-8 rounded-full border divider" />`;
    authBtn.textContent = "تسجيل الخروج";
    authBtn.onclick = () => signOut(auth);

    menuProfile.classList.remove("hidden");
    $("#menuAvatar").src = currentUser.photoURL || "";
    $("#menuName").textContent = currentUserDoc?.name || currentUser.displayName || "مستخدم";
    $("#menuRoleBadge").innerHTML = roleBadgeHTML(currentUserDoc?.role);
  } else {
    authArea.innerHTML = `<button id="btnQuickLogin" class="text-xs px-3 py-1.5 rounded-full bg-gold-500 text-ink-950 font-bold">دخول</button>`;
    $("#btnQuickLogin").onclick = doLogin;
    authBtn.textContent = "تسجيل الدخول بجوجل";
    authBtn.onclick = doLogin;
    menuProfile.classList.add("hidden");
  }

  const isAdmin = currentUser?.email === MAIN_ADMIN_EMAIL;
  const isMM = currentUserDoc?.role === "middleman";
  $('[data-nav="admin"]').classList.toggle("hidden", !isAdmin);
  $('[data-nav="mmRequests"]').classList.toggle("hidden", !isMM);
}

function roleBadgeHTML(role) {
  if (role === "admin") return `<span class="text-gold-400 font-bold">👑 المشرف الرئيسي</span>`;
  if (role === "middleman") return `<span class="text-teal-400 font-bold">🛡️ وسيط موثّق</span>`;
  return `<span>عضو</span>`;
}

async function doLogin() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (e) {
    console.error(e);
    toast("تعذّر تسجيل الدخول، حاول مرة أخرى");
  }
}

async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const isMainAdmin = user.email === MAIN_ADMIN_EMAIL;
  if (!snap.exists()) {
    const data = {
      uid: user.uid,
      name: user.displayName || "مستخدم",
      email: user.email,
      photoURL: user.photoURL || "",
      role: isMainAdmin ? "admin" : "user",
      nameColor: isMainAdmin ? "#E8C574" : "",
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: serverTimestamp(),
    };
    await setDoc(ref, data);
    return data;
  } else {
    // keep main admin role in sync even if doc predates this rule
    if (isMainAdmin && snap.data().role !== "admin") {
      await updateDoc(ref, { role: "admin" });
      return { ...snap.data(), role: "admin" };
    }
    return snap.data();
  }
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    currentUserDoc = await ensureUserDoc(user);
  } else {
    currentUserDoc = null;
  }
  renderAuthUI();
  renderPostGuard();
  if ($("#view-profile").classList.contains("hidden") === false) renderProfileView();
});

// --------------------------------------------------------------------------
// CATEGORIES
// --------------------------------------------------------------------------
function subscribeCategories() {
  const q = query(collection(db, "categories"), orderBy("name"));
  onSnapshot(q, (snap) => {
    categories = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderCategoryChips();
    renderOfferCategorySelect();
    renderAdminCategoriesList();
  });
}

function renderCategoryChips() {
  const wrap = $("#categoryChips");
  const chips = [{ id: "all", name: "الكل" }, ...categories];
  wrap.innerHTML = chips.map((c) => `
    <button data-cat="${c.id}" class="chip shrink-0 px-4 py-1.5 rounded-full text-sm border divider ${activeCategory === c.id ? "bg-gold-500 text-ink-950 border-gold-500 font-bold" : "surface-alt text-dim"}">
      ${esc(c.name)}
    </button>
  `).join("");
  $$("[data-cat]", wrap).forEach((b) => b.addEventListener("click", () => {
    activeCategory = b.dataset.cat;
    renderCategoryChips();
    subscribeOffers();
  }));
}

function renderOfferCategorySelect() {
  const sel = $("#offerCategory");
  if (!categories.length) {
    sel.innerHTML = `<option value="">لا توجد تصنيفات — أضف تصنيفًا من لوحة الأدمن أولاً</option>`;
    return;
  }
  sel.innerHTML = categories.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join("");
}

// --------------------------------------------------------------------------
// OFFERS FEED
// --------------------------------------------------------------------------
function subscribeOffers() {
  if (offersUnsub) offersUnsub();
  $("#offersLoading").classList.remove("hidden");
  $("#offersEmpty").classList.add("hidden");

  let q;
  if (activeCategory === "all") {
    q = query(collection(db, "offers"), orderBy("createdAt", "desc"), limit(60));
  } else {
    const catName = categories.find((c) => c.id === activeCategory)?.name;
    q = query(collection(db, "offers"), where("category", "==", catName || "___"), orderBy("createdAt", "desc"), limit(60));
  }

  offersUnsub = onSnapshot(q, (snap) => {
    $("#offersLoading").classList.add("hidden");
    const offers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderOffers(offers);
  }, (err) => {
    $("#offersLoading").classList.add("hidden");
    console.error(err);
  });
}

function renderOffers(offers) {
  const list = $("#offersList");
  $("#offersEmpty").classList.toggle("hidden", offers.length > 0);
  list.innerHTML = offers.map(offerCardHTML).join("");
  $$("[data-open-offer]", list).forEach((el) => {
    el.addEventListener("click", () => openOfferModal(el.dataset.openOffer, offers.find((o) => o.id === el.dataset.openOffer)));
  });
}

function offerCardHTML(o) {
  const img = (o.images && o.images[0]) || "";
  const typeLabel = o.type === "item" ? "عنصر" : "حساب";
  return `
  <article data-open-offer="${o.id}" class="stall-card rounded-xl overflow-hidden cursor-pointer">
    <div class="flex gap-3 p-3">
      <div class="w-20 h-20 rounded-lg overflow-hidden shrink-0 surface-alt flex items-center justify-center">
        ${img ? `<img src="${esc(img)}" class="w-full h-full object-cover" />` : `<span class="text-2xl">🎮</span>`}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] px-2 py-0.5 rounded-full surface-alt text-gold-400 border divider">${esc(o.category || "")}</span>
          <span class="text-[11px] text-dim">${typeLabel}</span>
        </div>
        <h3 class="font-bold mt-1 line-clamp-2">${esc(o.title)}</h3>
        <p class="text-sm text-dim line-clamp-2 mt-0.5">${esc(o.description)}</p>
        <div class="flex items-center justify-between mt-2">
          <span class="font-display font-bold text-gold-400">${esc(o.price)}</span>
          <span class="text-[11px] text-dim">${esc(o.posterName || "")}</span>
        </div>
      </div>
    </div>
  </article>`;
}

// --------------------------------------------------------------------------
// OFFER MODAL
// --------------------------------------------------------------------------
async function openOfferModal(id, cached) {
  let offer = cached;
  if (!offer) {
    const snap = await getDoc(doc(db, "offers", id));
    if (!snap.exists()) return toast("العرض لم يعد متاحًا");
    offer = { id, ...snap.data() };
  }
  const imgs = offer.images || [];
  const isOwner = currentUser && currentUser.uid === offer.posterId;

  $("#offerModalBody").innerHTML = `
    ${imgs.length ? `
      <div class="flex gap-2 overflow-x-auto">
        ${imgs.map((u) => `<img src="${esc(u)}" class="h-48 rounded-lg object-cover shrink-0" />`).join("")}
      </div>` : ""}
    <div class="flex items-center justify-between">
      <span class="text-xs px-2 py-1 rounded-full surface-alt text-gold-400 border divider">${esc(offer.category || "")}</span>
      <span class="text-xs text-dim">${timeAgo(offer.createdAt)}</span>
    </div>
    <h2 class="font-display font-bold text-xl">${esc(offer.title)}</h2>
    <p class="text-sm leading-7 text-dim whitespace-pre-line">${esc(offer.description)}</p>
    <div class="font-display font-bold text-2xl text-gold-400">${esc(offer.price)}</div>
    <div class="flex items-center gap-2 pt-2 border-t divider">
      <img src="${esc(offer.posterPhoto || "")}" class="w-9 h-9 rounded-full border divider" />
      <span class="text-sm font-bold">${esc(offer.posterName || "")}</span>
    </div>
    ${isOwner
      ? `<p class="text-center text-dim text-sm py-3">هذا عرضك الخاص</p>`
      : `<button id="btnStartChat" class="w-full py-3 rounded-lg bg-gold-500 text-ink-950 font-bold">تواصل مع البائع</button>`
    }
  `;
  if (!isOwner) {
    $("#btnStartChat").addEventListener("click", () => startChatForOffer(offer));
  }
  $("#offerModal").classList.remove("hidden");
}
$$("[data-close-offer]").forEach((el) => el.addEventListener("click", () => $("#offerModal").classList.add("hidden")));

// --------------------------------------------------------------------------
// POST OFFER
// --------------------------------------------------------------------------
function renderPostGuard() {
  const guard = $("#postGuard");
  const form = $("#offerForm");
  if (currentUser) {
    guard.classList.add("hidden");
    form.classList.remove("hidden");
  } else {
    guard.classList.remove("hidden");
    form.classList.add("hidden");
  }
}
$("#btnPostLogin").addEventListener("click", doLogin);
$("#btnProfileLogin").addEventListener("click", doLogin);

$("#offerImages").addEventListener("change", (e) => {
  offerImageFiles = Array.from(e.target.files).slice(0, 5);
  $("#offerImagesPreview").innerHTML = offerImageFiles.map((f) =>
    `<span class="text-xs surface-alt border divider rounded-full px-3 py-1">${esc(f.name)}</span>`
  ).join("");
});

async function uploadToImgBB(file) {
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json();
  if (!data.success) throw new Error("فشل رفع الصورة");
  return data.data.url;
}

$("#offerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return doLogin();
  const btn = $("#btnSubmitOffer");
  const status = $("#postStatus");
  btn.disabled = true;
  btn.textContent = "جاري النشر...";
  status.textContent = "";
  try {
    let imageUrls = [];
    if (offerImageFiles.length) {
      status.textContent = `جاري رفع ${offerImageFiles.length} صورة...`;
      imageUrls = await Promise.all(offerImageFiles.map(uploadToImgBB));
    }
    const category = $("#offerCategory").value;
    if (!category) throw new Error("الرجاء اختيار تصنيف صالح");

    await addDoc(collection(db, "offers"), {
      type: $("#offerType").value,
      category,
      title: $("#offerTitle").value.trim(),
      description: $("#offerDesc").value.trim(),
      price: $("#offerPrice").value.trim(),
      images: imageUrls,
      posterId: currentUser.uid,
      posterName: currentUserDoc?.name || currentUser.displayName,
      posterPhoto: currentUser.photoURL || "",
      status: "available",
      createdAt: serverTimestamp(),
    });

    toast("تم نشر العرض بنجاح ✅");
    $("#offerForm").reset();
    offerImageFiles = [];
    $("#offerImagesPreview").innerHTML = "";
    goTo("feed");
  } catch (err) {
    console.error(err);
    status.textContent = err.message || "حدث خطأ أثناء النشر";
  } finally {
    btn.disabled = false;
    btn.textContent = "نشر العرض";
  }
});

// --------------------------------------------------------------------------
// CHAT
// --------------------------------------------------------------------------
function chatIdFor(offerId, buyerId, sellerId) {
  return `${offerId}_${buyerId}_${sellerId}`;
}

async function startChatForOffer(offer) {
  const buyerId = currentUser.uid;
  const sellerId = offer.posterId;
  const chatId = chatIdFor(offer.id, buyerId, sellerId);
  const ref = doc(db, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      offerId: offer.id,
      offerTitle: offer.title,
      buyerId, buyerName: currentUserDoc?.name || currentUser.displayName,
      sellerId, sellerName: offer.posterName,
      middlemanId: null,
      middlemanName: null,
      middlemanRequested: false,
      status: "active",
      participants: [buyerId, sellerId],
      createdAt: serverTimestamp(),
      ratedBy: [],
    });
  }
  $("#offerModal").classList.add("hidden");
  openChat(chatId);
}

function openChat(chatId) {
  activeChat = { id: chatId };
  $("#chatModal").classList.remove("hidden");
  $("#chatMessages").innerHTML = `<div class="flex justify-center py-6"><div class="spinner"></div></div>`;

  if (chatUnsubDoc) chatUnsubDoc();
  chatUnsubDoc = onSnapshot(doc(db, "chats", chatId), (snap) => {
    if (!snap.exists()) return;
    activeChat = { id: chatId, ...snap.data() };
    renderChatHeader();
  });

  if (chatUnsubMsgs) chatUnsubMsgs();
  const mq = query(collection(db, "chats", chatId, "messages"), orderBy("createdAt", "asc"), limit(200));
  chatUnsubMsgs = onSnapshot(mq, (snap) => {
    renderChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

function renderChatHeader() {
  const c = activeChat;
  const isBuyer = currentUser?.uid === c.buyerId;
  const otherName = isBuyer ? c.sellerName : c.buyerName;
  $("#chatTitle").textContent = c.offerTitle || "محادثة";
  $("#chatSubtitle").textContent = c.middlemanId
    ? `مع ${otherName} · 🛡️ الوسيط: ${c.middlemanName}`
    : `مع ${otherName}`;

  const isParticipantBS = currentUser && (currentUser.uid === c.buyerId || currentUser.uid === c.sellerId);
  const isMMHere = currentUser && currentUser.uid === c.middlemanId;

  // request middleman button: visible to buyer/seller if no middleman yet
  $("#btnRequestMM").classList.toggle("hidden", !(isParticipantBS && !c.middlemanId));
  $("#btnRequestMM").textContent = c.middlemanRequested ? "بانتظار وسيط..." : "طلب وسيط";
  $("#btnRequestMM").disabled = !!c.middlemanRequested;

  // complete trade button: visible to buyer/seller while active
  $("#btnCompleteTrade").classList.toggle("hidden", !(isParticipantBS && c.status === "active"));

  // confidential composer toggle: visible when a middleman is present and user is buyer/seller/middleman
  $("#mmComposerToggle").classList.toggle("hidden", !(c.middlemanId && (isParticipantBS || isMMHere)));
}

function renderChatMessages(msgs) {
  const wrap = $("#chatMessages");
  const c = activeChat;
  const uid = currentUser?.uid;
  const isMMHere = uid && uid === c.middlemanId;

  const visible = msgs.filter((m) => {
    if (m.visibility !== "middleman") return true;
    return m.senderId === uid || isMMHere;
  });

  wrap.innerHTML = visible.map((m) => {
    const mine = m.senderId === uid;
    const isPrivate = m.visibility === "middleman";
    return `
    <div class="flex ${mine ? "justify-start" : "justify-end"}">
      <div class="max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
        isPrivate
          ? "bg-teal-500/15 border border-teal-500/40 text-teal-300"
          : mine ? "bg-gold-500 text-ink-950" : "surface-alt border divider"
      }">
        ${isPrivate ? `<div class="text-[10px] font-bold mb-0.5">🔒 سري — للوسيط</div>` : ""}
        <div class="text-[10px] ${mine && !isPrivate ? "text-ink-900/70" : "text-dim"} mb-0.5 font-bold">${esc(m.senderName)}</div>
        <div>${esc(m.text)}</div>
      </div>
    </div>`;
  }).join("");
  wrap.scrollTop = wrap.scrollHeight;
}

$("#chatForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || !activeChat) return;
  const input = $("#chatInput");
  const text = input.value.trim();
  if (!text) return;
  const isPrivate = $("#privateToMM").checked;
  input.value = "";
  try {
    await addDoc(collection(db, "chats", activeChat.id, "messages"), {
      senderId: currentUser.uid,
      senderName: currentUserDoc?.name || currentUser.displayName,
      text,
      visibility: isPrivate ? "middleman" : "all",
      createdAt: serverTimestamp(),
    });
    if (isPrivate) $("#privateToMM").checked = false;
  } catch (err) {
    console.error(err);
    toast("تعذّر إرسال الرسالة");
  }
});

$("#btnRequestMM").addEventListener("click", async () => {
  if (!activeChat) return;
  await updateDoc(doc(db, "chats", activeChat.id), { middlemanRequested: true });
  toast("تم إرسال طلب وسيط، بانتظار انضمام أحدهم");
});

$$("[data-close-chat]").forEach((el) => el.addEventListener("click", closeChat));
function closeChat() {
  $("#chatModal").classList.add("hidden");
  if (chatUnsubMsgs) chatUnsubMsgs();
  if (chatUnsubDoc) chatUnsubDoc();
  activeChat = null;
}

$("#btnCompleteTrade").addEventListener("click", async () => {
  if (!activeChat) return;
  await updateDoc(doc(db, "chats", activeChat.id), { status: "completed" });
  toast("تم تحديد الصفقة كمكتملة");
  openRatingFlow(activeChat);
});

// --------------------------------------------------------------------------
// MIDDLEMAN REQUESTS (for middleman users)
// --------------------------------------------------------------------------
async function loadMiddlemanRequests() {
  const list = $("#mmRequestsList");
  list.innerHTML = `<div class="flex justify-center py-6"><div class="spinner"></div></div>`;
  const q = query(collection(db, "chats"), where("middlemanRequested", "==", true), where("middlemanId", "==", null));
  const snap = await getDocs(q);
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  $("#mmRequestsEmpty").classList.toggle("hidden", rows.length > 0);
  list.innerHTML = rows.map((c) => `
    <div class="stall-card rounded-xl p-3 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <div class="font-bold truncate">${esc(c.offerTitle)}</div>
        <div class="text-xs text-dim">بين ${esc(c.buyerName)} و ${esc(c.sellerName)}</div>
      </div>
      <button data-join="${c.id}" class="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-teal-500 text-ink-950 font-bold">انضمام كوسيط</button>
    </div>
  `).join("");
  $$("[data-join]", list).forEach((b) => b.addEventListener("click", () => joinAsMiddleman(b.dataset.join)));
}

async function joinAsMiddleman(chatId) {
  await updateDoc(doc(db, "chats", chatId), {
    middlemanId: currentUser.uid,
    middlemanName: currentUserDoc?.name || currentUser.displayName,
    participants: arrayUnion(currentUser.uid),
  });
  toast("تم انضمامك كوسيط لهذه المحادثة");
  loadMiddlemanRequests();
  openChat(chatId);
}

// --------------------------------------------------------------------------
// RATINGS
// --------------------------------------------------------------------------
function openRatingFlow(chat) {
  pendingRatingQueue = [];
  const uid = currentUser?.uid;
  if (chat.middlemanId) {
    if (uid === chat.buyerId || uid === chat.sellerId) {
      pendingRatingQueue.push({ chatId: chat.id, targetId: chat.middlemanId, targetLabel: `الوسيط: ${chat.middlemanName}` });
    }
  } else {
    if (uid === chat.buyerId) pendingRatingQueue.push({ chatId: chat.id, targetId: chat.sellerId, targetLabel: `البائع: ${chat.sellerName}` });
    if (uid === chat.sellerId) pendingRatingQueue.push({ chatId: chat.id, targetId: chat.buyerId, targetLabel: `المشتري: ${chat.buyerName}` });
  }
  showNextRating();
}

function showNextRating() {
  if (!pendingRatingQueue.length) {
    $("#ratingModal").classList.add("hidden");
    return;
  }
  const next = pendingRatingQueue[0];
  $("#ratingTargetLabel").textContent = `تقييم ${next.targetLabel}`;
  selectedStars = 0;
  renderStarPicker();
  $("#ratingComment").value = "";
  $("#ratingModal").classList.remove("hidden");
  $("#ratingModal").classList.add("flex");
}

function renderStarPicker() {
  const wrap = $("#starPicker");
  wrap.innerHTML = "";
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement("button");
    s.textContent = i <= selectedStars ? "★" : "☆";
    s.className = "text-gold-400";
    s.addEventListener("click", () => { selectedStars = i; renderStarPicker(); });
    wrap.appendChild(s);
  }
}

$("#btnSubmitRating").addEventListener("click", async () => {
  if (!selectedStars) return toast("الرجاء اختيار عدد النجوم");
  const item = pendingRatingQueue.shift();
  try {
    await addDoc(collection(db, "ratings"), {
      chatId: item.chatId,
      raterId: currentUser.uid,
      targetId: item.targetId,
      stars: selectedStars,
      comment: $("#ratingComment").value.trim(),
      createdAt: serverTimestamp(),
    });
    await recomputeUserRating(item.targetId);
    toast("شكراً لتقييمك!");
  } catch (err) {
    console.error(err);
    toast("تعذّر إرسال التقييم");
  }
  showNextRating();
});
$$("[data-close-rating]").forEach((el) => el.addEventListener("click", () => {
  pendingRatingQueue = [];
  $("#ratingModal").classList.add("hidden");
}));

async function recomputeUserRating(targetUid) {
  const q = query(collection(db, "ratings"), where("targetId", "==", targetUid));
  const snap = await getDocs(q);
  let sum = 0, count = 0;
  snap.forEach((d) => { sum += d.data().stars || 0; count++; });
  const avg = count ? sum / count : 0;
  await updateDoc(doc(db, "users", targetUid), { ratingAvg: avg, ratingCount: count });
}

// --------------------------------------------------------------------------
// PROFILE VIEW
// --------------------------------------------------------------------------
async function renderProfileView() {
  const guard = $("#profileGuard");
  const content = $("#profileContent");
  if (!currentUser) {
    guard.classList.remove("hidden");
    content.classList.add("hidden");
    return;
  }
  guard.classList.add("hidden");
  content.classList.remove("hidden");

  const userSnap = await getDoc(doc(db, "users", currentUser.uid));
  const u = userSnap.data() || {};
  $("#profileAvatar").src = currentUser.photoURL || "";
  $("#profileName").textContent = u.name || currentUser.displayName;
  $("#profileRole").innerHTML = roleBadgeHTML(u.role);
  $("#profileRating").textContent = u.ratingCount
    ? `${stars(u.ratingAvg)} (${u.ratingAvg.toFixed(1)} من ${u.ratingCount} تقييم)`
    : "لا يوجد تقييمات بعد";

  // my chats
  const chatsQ = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid), orderBy("createdAt", "desc"), limit(30));
  const chatsSnap = await getDocs(chatsQ);
  const chats = chatsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  $("#myChats").innerHTML = chats.length ? chats.map((c) => `
    <button data-open-chat="${c.id}" class="w-full text-right stall-card rounded-xl p-3 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="font-bold truncate text-sm">${esc(c.offerTitle)}</div>
        <div class="text-xs text-dim">${c.status === "completed" ? "✅ مكتملة" : "🟢 نشطة"}${c.middlemanId ? " · 🛡️ بوسيط" : ""}</div>
      </div>
    </button>
  `).join("") : `<p class="text-dim text-sm text-center py-4">لا توجد محادثات بعد.</p>`;
  $$("[data-open-chat]", $("#myChats")).forEach((b) => b.addEventListener("click", () => openChat(b.dataset.openChat)));

  // my offers
  const offersQ = query(collection(db, "offers"), where("posterId", "==", currentUser.uid), orderBy("createdAt", "desc"));
  const offersSnap = await getDocs(offersQ);
  const myOffers = offersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  $("#myOffers").innerHTML = myOffers.length ? myOffers.map((o) => `
    <div class="stall-card rounded-xl p-3 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="font-bold truncate text-sm">${esc(o.title)}</div>
        <div class="text-xs text-dim">${esc(o.price)}</div>
      </div>
      <button data-del-offer="${o.id}" class="text-xs text-coral-500 px-2 py-1">حذف</button>
    </div>
  `).join("") : `<p class="text-dim text-sm text-center py-4">لم تنشر أي عرض بعد.</p>`;
  $$("[data-del-offer]", $("#myOffers")).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("هل تريد حذف هذا العرض؟")) return;
    await deleteDoc(doc(db, "offers", b.dataset.delOffer));
    renderProfileView();
  }));
}

// --------------------------------------------------------------------------
// ADMIN VIEW
// --------------------------------------------------------------------------
function renderAdminView() {
  renderAdminCategoriesList();
}

function renderAdminCategoriesList() {
  const wrap = $("#adminCategoriesList");
  if (!wrap) return;
  wrap.innerHTML = categories.length ? categories.map((c) => `
    <div class="flex items-center justify-between surface-alt border divider rounded-lg px-3 py-2">
      <span>${esc(c.name)}</span>
      <button data-del-cat="${c.id}" class="text-coral-500 text-sm">حذف</button>
    </div>
  `).join("") : `<p class="text-dim text-sm">لا توجد تصنيفات بعد.</p>`;
  $$("[data-del-cat]", wrap).forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("حذف هذا التصنيف؟")) return;
    await deleteDoc(doc(db, "categories", b.dataset.delCat));
  }));
}

$("#btnAddCategory").addEventListener("click", async () => {
  const input = $("#newCategoryInput");
  const name = input.value.trim();
  if (!name) return;
  await addDoc(collection(db, "categories"), { name, createdAt: serverTimestamp() });
  input.value = "";
  toast("تمت إضافة التصنيف");
});

$("#btnPromote").addEventListener("click", async () => {
  const email = $("#promoteEmailInput").value.trim().toLowerCase();
  const status = $("#promoteStatus");
  if (!email) return;
  status.textContent = "جاري البحث...";
  try {
    const q = query(collection(db, "users"), where("email", "==", email), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      status.textContent = "لم يتم العثور على مستخدم بهذا البريد. يجب أن يسجّل دخوله مرة واحدة أولاً.";
      return;
    }
    const userDoc = snap.docs[0];
    await updateDoc(doc(db, "users", userDoc.id), { role: "middleman", nameColor: "#3FBFAE" });
    status.textContent = `تمت ترقية ${userDoc.data().name} إلى وسيط ✅`;
    $("#promoteEmailInput").value = "";
  } catch (err) {
    console.error(err);
    status.textContent = "حدث خطأ أثناء الترقية.";
  }
});

// admin guard: block access if not main admin (Firestore rules are the real
// enforcement layer — this just avoids flashing the UI to non-admins)
function guardAdminView() {
  const el = $("#view-admin");
  if (currentUser?.email !== MAIN_ADMIN_EMAIL) {
    el.innerHTML = `<div class="p-10 text-center text-dim">🔒 هذه الصفحة مخصصة للمشرف الرئيسي فقط.</div>`;
  }
}

// --------------------------------------------------------------------------
// BOOT
// --------------------------------------------------------------------------
subscribeCategories();
subscribeOffers();
goTo("feed");
