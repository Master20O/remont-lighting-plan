window.SOCKETS_DATA = {
  plan: {
    imagePath: "assets/plan_top_view_clean.png",
    width: 2380,
    height: 2300,
    apartmentBounds: {
      minX: 380,
      minY: 120,
      maxX: 2240,
      maxY: 2300
    }
  },
  stage1TargetSockets: 24,
  rooms: [
    "Прихожая",
    "Кладовая",
    "Зал (правая пол.)",
    "Зал (левая пол.)",
    "Кухня",
    "Балкон",
    "Санузел",
    "Спальня"
  ],
  wallSegments: [
    // --- ЭТАП 1: ПРАВАЯ ПОЛОВИНА ЗАЛА + ПРИХОЖАЯ ---
    { id: "liv_top_r",     stage: 1, room: "Зал (правая пол.)", label: "Верхняя стена зала правая (3 220 мм)", x1: 1026, y1: 455,  x2: 1570, y2: 455,  lengthMm: 3220, normal: "down" },
    { id: "liv_right",     stage: 1, room: "Зал (правая пол.)", label: "Правая стена зала ТВ (3 000 мм)", x1: 1570, y1: 455,  x2: 1570, y2: 986,  lengthMm: 3000, normal: "left" },
    { id: "liv_pier",      stage: 1, room: "Зал (правая пол.)", label: "Простенок зала (1 360 мм)", x1: 1026, y1: 455,  x2: 1026, y2: 700,  lengthMm: 1360, normal: "right" },
    { id: "liv_kitch_pier",stage: 1, room: "Зал (правая пол.)", label: "Простенок у входа в кухню (570 мм)", x1: 1530, y1: 1030, x2: 1750, y2: 1030, lengthMm: 570, normal: "down" },
    { id: "liv_bot",       stage: 1, room: "Зал (правая пол.)", label: "Нижняя стена зала вдоль кладовой (4 320 мм)", x1: 958,  y1: 1311, x2: 1750, y2: 1311, lengthMm: 4320, normal: "up" },
    { id: "ac_door",       stage: 1, room: "Зал (правая пол.)", label: "Над дверным проёмом спальни (1 000 мм)", x1: 770,  y1: 1580, x2: 955,  y2: 1580, lengthMm: 1000, normal: "up" },
    { id: "hall_right",    stage: 1, room: "Прихожая",          label: "Правая стена прихожей (2 400 мм)", x1: 1855, y1: 1068, x2: 1855, y2: 1511, lengthMm: 2400, normal: "left" },
    { id: "hall_left",     stage: 1, room: "Прихожая",          label: "Левая стена прихожей у кладовой (1 100 мм)", x1: 1750, y1: 1311, x2: 1750, y2: 1511, lengthMm: 1100, normal: "right" },
    { id: "hall_bot",      stage: 1, room: "Прихожая",          label: "Нижняя стена прихожей ЩР/М (920 мм)", x1: 1750, y1: 1511, x2: 1855, y2: 1511, lengthMm: 920,  normal: "up" },

    // --- ЭТАП 2: ОСТАЛЬНЫЕ ПОМЕЩЕНИЯ ---
    { id: "kitch_right", stage: 2, room: "Кухня", label: "Правая стена кухни (3 216 мм)", x1: 2083, y1: 398, x2: 2083, y2: 1030, lengthMm: 3216, normal: "left" },
    { id: "kitch_left",  stage: 2, room: "Кухня", label: "Левая стена кухни (3 000 мм)", x1: 1613, y1: 398, x2: 1613, y2: 986,  lengthMm: 3000, normal: "right" },
    { id: "kitch_top",   stage: 2, room: "Кухня", label: "Верхняя стена кухни (2 930 мм)", x1: 1613, y1: 398, x2: 2083, y2: 398,  lengthMm: 2930, normal: "down" },

    { id: "liv_top_l",   stage: 2, room: "Зал (левая пол.)", label: "Верхняя стена зала левая (2 850 мм)", x1: 488,  y1: 455,  x2: 983,  y2: 455,  lengthMm: 2850, normal: "down" },
    { id: "liv_left",    stage: 2, room: "Зал (левая пол.)", label: "Левая стена зала (3 740 мм)", x1: 488,  y1: 455,  x2: 488,  y2: 1076, lengthMm: 3740, normal: "right" },

    { id: "pantry_top",  stage: 2, room: "Кладовая", label: "Верхняя стена кладовой (4 150 мм)", x1: 1020, y1: 1355, x2: 1730, y2: 1355, lengthMm: 4150, normal: "down" },

    { id: "bath_top",    stage: 2, room: "Санузел", label: "Верхняя стена ванной (1 730 мм)", x1: 490,  y1: 1118, x2: 725,  y2: 1118, lengthMm: 1730, normal: "down" },
    { id: "bath_right",  stage: 2, room: "Санузел", label: "Правая стена санузла (2 900 мм)", x1: 725,  y1: 1118, x2: 725,  y2: 1591, lengthMm: 2900, normal: "left" },
    { id: "bath_entry",  stage: 2, room: "Санузел", label: "Простенок входа в санузел (1 200 мм)", x1: 769,  y1: 1330, x2: 769,  y2: 1550, lengthMm: 1200, normal: "right" },

    { id: "balc_bot",    stage: 2, room: "Балкон",  label: "Балкон — низ слева от двери (1 135 мм)", x1: 1570, y1: 352,  x2: 1753, y2: 352,  lengthMm: 1135, normal: "up" },
    { id: "balc_top",    stage: 2, room: "Балкон",  label: "Балкон — верхняя стена (2 870 мм)", x1: 1570, y1: 180,  x2: 2029, y2: 180,  lengthMm: 2870, normal: "down" },

    { id: "bed_right",   stage: 2, room: "Спальня", label: "Правая стена спальни изголовье (3 710 мм)", x1: 955,  y1: 1636, x2: 955,  y2: 2229, lengthMm: 3710, normal: "left" },
    { id: "bed_left",    stage: 2, room: "Спальня", label: "Левая стена спальни с окном (3 710 мм)", x1: 463,  y1: 1636, x2: 463,  y2: 2229, lengthMm: 3710, normal: "right" },
    { id: "bed_top",     stage: 2, room: "Спальня", label: "Верхняя стена спальни (2 850 мм)", x1: 463,  y1: 1636, x2: 955,  y2: 1636, lengthMm: 2850, normal: "down" },
    { id: "bed_bot",     stage: 2, room: "Спальня", label: "Нижняя стена спальни (2 850 мм)", x1: 463,  y1: 2229, x2: 955,  y2: 2229, lengthMm: 2850, normal: "up" }
  ],
  shieldAnchor: { x: 1775, y: 1511 },
  wifiAnchor: { x: 1832, y: 1511 },
  groups: [
    { id: "G12", stage: 1, code: "Гр. 12", name: "Правая половина зала (23 роз. + RJ-45, 2 570 Вт)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#2563eb", nonMaster: true },
    { id: "G08", stage: 1, code: "Гр. 08", name: "НЕОТКЛЮЧАЕМЫЕ: Wi-Fi роутер (+ Холодильник/Вытяжка)", breaker: "C16 (неоткл.)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#0284c7", nonMaster: true },
    { id: "G09", stage: 1, code: "Гр. 09", name: "Кондиционер (вывод 3×2,5 без розетки)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#0ea5e9", nonMaster: true },

    { id: "G02", stage: 2, code: "Гр. 02", name: "Варочная панель (плита)", breaker: "C32 + дифавтомат", maxWatts: 7360, cable: "ВВГ 3×6,0", color: "#dc2626", nonMaster: true },
    { id: "G03", stage: 2, code: "Гр. 03", name: "Духовой шкаф (кухня справа)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#ea580c", nonMaster: true },
    { id: "G04", stage: 2, code: "Гр. 04", name: "Стиральная машина (кухня справа)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#d97706", nonMaster: true },
    { id: "G05", stage: 2, code: "Гр. 05", name: "Сушильная машина (кухня справа)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#ca8a04", nonMaster: true },
    { id: "G06", stage: 2, code: "Гр. 06", name: "ПММ + мойка/фильтр/измельчитель", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#65a30d", nonMaster: true },
    { id: "G07", stage: 2, code: "Гр. 07", name: "Фартук кухни (чайник, СВЧ, кофе)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#059669", nonMaster: true },
    { id: "G10", stage: 2, code: "Гр. 10", name: "Тёплые полы (ванная + балкон)", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#7c3aed", nonMaster: true },
    { id: "G11", stage: 2, code: "Гр. 11", name: "Санузел IP44+ (раковина, ПС, протечки/бойлер)", breaker: "C16 (УЗО 10 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#0891b2", nonMaster: true },
    { id: "G13", stage: 2, code: "Гр. 13", name: "Левая половина зала + Балкон + бытовой резерв", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#4f46e5", nonMaster: true },
    { id: "G14", stage: 2, code: "Гр. 14", name: "Спальня (тумбы h=600) + Прихожая (резерв) + Кладовая + кормушка", breaker: "C16 (УЗО А 30 мА)", maxWatts: 3680, cable: "ВВГ 3×2,5", color: "#db2777", nonMaster: true }
  ],
  blocks: [
    // --- ЭТАП 1: ПРАВАЯ ПОЛОВИНА ЗАЛА + ПРИХОЖАЯ (строго 24 розетки 230В под 24 устройства + 1 RJ-45 + вывод конд. + ЩР) ---
    {
      id: "R1", stage: 1, room: "Зал (правая пол.)", title: "Видеосвет 3 (200 Вт) + Селфи-лампа (30 Вт)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 230, groupId: "G12",
      wallId: "liv_top_r", x: 1095, y: 455, refSide: "left", offsetMm: 410, heightMm: 300, byPencil: true, comment: "25) Видеосвет 200 Вт + 26) Селфи-лампа 30 Вт"
    },
    {
      id: "R2", stage: 1, room: "Зал (правая пол.)", title: "Шторы (электрокарниз за гардиной)",
      kind: "socket", sockets: 1, rj45: 0, ip44: false, watts: 65, groupId: "G12",
      wallId: "liv_top_r", x: 1355, y: 455, refSide: "right", offsetMm: 1270, heightMm: 2600, byPencil: false, comment: "55) Электрокарниз штор у потолка за гардиной"
    },
    {
      id: "R3", stage: 1, room: "Зал (правая пол.)", title: "Гирлянды + Колонка бол. 1 + Видеосвет 1",
      kind: "socket", sockets: 3, rj45: 0, ip44: false, watts: 530, groupId: "G12",
      wallId: "liv_top_r", x: 1495, y: 455, refSide: "right", offsetMm: 440, heightMm: 300, byPencil: true, comment: "32) Гирлянды (30 Вт) + 12) Колонка 1 (250 Вт) + 23) Видеосвет 1 (250 Вт)"
    },
    {
      id: "R4", stage: 1, room: "Зал (правая пол.)", title: "Телевизор (за экраном)",
      kind: "socket", sockets: 1, rj45: 0, ip44: false, watts: 200, groupId: "G12",
      wallId: "liv_right", x: 1570, y: 625, refSide: "left", offsetMm: 960, heightMm: 1300, byPencil: false, comment: "10) Телевизор 200 Вт"
    },
    {
      id: "R5", stage: 1, room: "Зал (правая пол.)", title: "Макбук 1 + 2 Айфона + Колонка мал. 1",
      kind: "socket", sockets: 4, rj45: 0, ip44: false, watts: 190, groupId: "G12",
      wallId: "liv_pier", x: 1026, y: 655, refSide: "left", offsetMm: 1110, heightMm: 300, byPencil: true, comment: "2) Макбук (90 Вт) + 4,5) 2 Айфона (40 Вт) + 14) Колонка мал. 1 (60 Вт)"
    },
    {
      id: "R6", stage: 1, room: "Зал (правая пол.)", title: "PS5 интернет RJ-45 (от роутера Cat 6)",
      kind: "rj45", sockets: 0, rj45: 1, ip44: false, watts: 0, groupId: "G12",
      wallId: "liv_right", x: 1570, y: 710, refSide: "left", offsetMm: 1440, heightMm: 300, byPencil: false, comment: "9) Интернет-кабель Cat 6 к PlayStation от Wi-Fi роутера"
    },
    {
      id: "R7", stage: 1, room: "Зал (правая пол.)", title: "PlayStation + Караоке + ЗУ камеры + ЗУ микр.",
      kind: "socket", sockets: 4, rj45: 0, ip44: false, watts: 430, groupId: "G12",
      wallId: "liv_right", x: 1570, y: 795, refSide: "left", offsetMm: 1920, heightMm: 300, byPencil: true, comment: "9) PS5 (350 Вт) + 31) Микр. (30 Вт) + 35) ЗУ кам. (30 Вт) + 36) ЗУ микр. (20 Вт)"
    },
    {
      id: "R8", stage: 1, room: "Зал (правая пол.)", title: "Колонка бол. 2 + Видеосвет 2",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 500, groupId: "G12",
      wallId: "liv_right", x: 1570, y: 915, refSide: "right", offsetMm: 400, heightMm: 300, byPencil: true, comment: "13) Колонка большая 2 (250 Вт) + 24) Видеосвет 2 (250 Вт)"
    },
    {
      id: "R9", stage: 1, room: "Зал (правая пол.)", title: "Проектор + Колонка мал. 2",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 260, groupId: "G12",
      wallId: "liv_bot", x: 1115, y: 1311, refSide: "left", offsetMm: 860, heightMm: 300, byPencil: true, comment: "1) Проектор (200 Вт) + 15) Колонка мал. 2 (60 Вт)"
    },
    {
      id: "R10", stage: 1, room: "Зал (правая пол.)", title: "Макбук 2 + 2 Айфона + Андроид",
      kind: "socket", sockets: 4, rj45: 0, ip44: false, watts: 165, groupId: "G12",
      wallId: "liv_bot", x: 1405, y: 1311, refSide: "right", offsetMm: 1880, heightMm: 300, byPencil: true, comment: "3) Макбук (90 Вт) + 6,7) 2 Айфона (40 Вт) + 8) Андроид (35 Вт)"
    },
    {
      id: "R13", stage: 1, room: "Зал (правая пол.)", title: "ВЫВОД КОНДИЦИОНЕРА (без розетки)",
      kind: "cable", sockets: 0, rj45: 0, ip44: false, watts: 1400, groupId: "G09",
      wallId: "ac_door", x: 865, y: 1580, refSide: "left", offsetMm: 510, heightMm: 2450, byPencil: false, comment: "38) Прямой вывод 3×2,5 БЕЗ розетки над дверью спальни (дует в зал)"
    },
    {
      id: "R15", stage: 1, room: "Прихожая", title: "Wi-Fi роутер (ВНЕ ЩР)",
      kind: "socket", sockets: 1, rj45: 0, ip44: false, watts: 30, groupId: "G08",
      wallId: "hall_right", x: 1855, y: 1455, refSide: "right", offsetMm: 300, heightMm: 2150, byPencil: false, comment: "22) Wi-Fi роутер h=2150 ВНЕ железного щита; отсюда витая пара Cat 6 в зал"
    },
    {
      id: "R16", stage: 1, room: "Прихожая", title: "Щит ЩР (36–48 мод. над М)",
      kind: "shield", sockets: 0, rj45: 0, ip44: false, watts: 0, groupId: "G08",
      wallId: "hall_bot", x: 1800, y: 1511, refSide: "left", offsetMm: 460, heightMm: 1700, byPencil: false, comment: "Ось 460 мм (1/2 стены 920 мм), строго над мастером М"
    },

    // --- ЭТАП 2: ОСТАЛЬНЫЕ ПОМЕЩЕНИЯ И БЫТОВОЙ РЕЗЕРВ ---
    {
      id: "R11", stage: 2, room: "Зал (левая пол.)", title: "Зал лево верх (3×230В + RJ-45 Cat 6)",
      kind: "socket", sockets: 3, rj45: 1, ip44: false, watts: 350, groupId: "G13",
      wallId: "liv_top_l", x: 585, y: 455, refSide: "left", offsetMm: 560, heightMm: 300, byPencil: true, comment: "Стол/ПК + проводной RJ-45 Cat 6 от роутера"
    },
    {
      id: "R12", stage: 2, room: "Зал (левая пол.)", title: "Зал левая стена под окном",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 200, groupId: "G13",
      wallId: "liv_left", x: 488, y: 1005, refSide: "right", offsetMm: 430, heightMm: 300, byPencil: true, comment: "По карандашной разметке на стене (резерв под пылесос/лампу)"
    },
    {
      id: "R14", stage: 2, room: "Прихожая (резерв 2 этап)", title: "Прихожая у входа (пылесос/сушилка)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 300, groupId: "G14",
      wallId: "hall_right", x: 1855, y: 1345, refSide: "right", offsetMm: 900, heightMm: 300, byPencil: true, comment: "Дежурная двойная розетка по карандашу"
    },
    {
      id: "R17", stage: 2, room: "Кладовая", title: "База робота-пылесоса / зарядка",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 100, groupId: "G14",
      wallId: "pantry_top", x: 1165, y: 1355, refSide: "left", offsetMm: 850, heightMm: 300, byPencil: false, comment: "Запитана ДО М; робот на зарядке 24/7"
    },
    {
      id: "R18", stage: 2, room: "Кухня", title: "Стиральная + сушильная машины (сбоку в тумбе)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 2200, groupId: "G04",
      wallId: "kitch_right", x: 2083, y: 492, refSide: "left", offsetMm: 480, heightMm: 400, byPencil: false, comment: "2 отдельные линии (Гр. 04 + Гр. 05), ставить сбоку от машин"
    },
    {
      id: "R19", stage: 2, room: "Кухня", title: "Посудомойка + мойка/фильтр/измельчитель",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 2100, groupId: "G06",
      wallId: "kitch_right", x: 2083, y: 595, refSide: "left", offsetMm: 1000, heightMm: 450, byPencil: false, comment: "Розетка ПММ строго в тумбе под мойкой (не за корпусом ПММ)"
    },
    {
      id: "R20", stage: 2, room: "Кухня", title: "Фартук кухни — блок 1 (3×)",
      kind: "socket", sockets: 3, rj45: 0, ip44: false, watts: 1500, groupId: "G07",
      wallId: "kitch_right", x: 2083, y: 695, refSide: "left", offsetMm: 1510, heightMm: 1050, byPencil: false, comment: "Чайник / кофемашина / блендер"
    },
    {
      id: "R21", stage: 2, room: "Кухня", title: "Фартук кухни — блок 2 (3×)",
      kind: "socket", sockets: 3, rj45: 0, ip44: false, watts: 1200, groupId: "G07",
      wallId: "kitch_right", x: 2083, y: 790, refSide: "right", offsetMm: 1220, heightMm: 1050, byPencil: false, comment: "СВЧ / тостер / мультиварка"
    },
    {
      id: "R22", stage: 2, room: "Кухня", title: "Духовка (h=300) + Скрытая вытяжка (h=2150)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 2800, groupId: "G03",
      wallId: "kitch_right", x: 2083, y: 885, refSide: "right", offsetMm: 740, heightMm: 300, byPencil: false, comment: "Духовка Гр. 03 (h=300) + вытяжка без выкл. Гр. 08 (h=2150)"
    },
    {
      id: "R23", stage: 2, room: "Кухня", title: "Варочная панель / плита у входа (3×6,0)",
      kind: "power", sockets: 0, rj45: 0, ip44: false, watts: 7000, groupId: "G02",
      wallId: "kitch_right", x: 2083, y: 975, refSide: "right", offsetMm: 280, heightMm: 300, byPencil: false, comment: "Прямой силовой кабель 3×6,0 мм² на C32"
    },
    {
      id: "R24", stage: 2, room: "Кухня", title: "Холодильник слева (НЕОТКЛЮЧАЕМЫЙ ДО М)",
      kind: "socket", sockets: 1, rj45: 0, ip44: false, watts: 250, groupId: "G08",
      wallId: "kitch_left", x: 1613, y: 590, refSide: "right", offsetMm: 980, heightMm: 300, byPencil: false, comment: "Строго ДО контактора М на Гр. 08"
    },
    {
      id: "R25", stage: 2, room: "Кухня", title: "Кормушка и поилка котов (слева, ДО М)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 40, groupId: "G14",
      wallId: "kitch_left", x: 1613, y: 855, refSide: "left", offsetMm: 670, heightMm: 300, byPencil: false, comment: "Питание 24/7 ДО контактора М"
    },
    {
      id: "R26", stage: 2, room: "Санузел", title: "У раковины 2×IP44+ (фен, щётка, ирригатор)",
      kind: "socket", sockets: 2, rj45: 0, ip44: true, watts: 1800, groupId: "G11",
      wallId: "bath_top", x: 685, y: 1118, refSide: "right", offsetMm: 290, heightMm: 950, byPencil: false, comment: "УЗО 10 мА; в перегородке 105 мм ставить подрозетники 45 мм"
    },
    {
      id: "R27", stage: 2, room: "Санузел", title: "Полотенцесушитель (вывод 3×2,5 без розетки)",
      kind: "cable", sockets: 0, rj45: 0, ip44: true, watts: 350, groupId: "G11",
      wallId: "bath_right", x: 725, y: 1300, refSide: "left", offsetMm: 1110, heightMm: 800, byPencil: false, comment: "Скрытое подключение"
    },
    {
      id: "R28", stage: 2, room: "Санузел", title: "Защита от протечек / бойлер 2×IP44+",
      kind: "socket", sockets: 2, rj45: 0, ip44: true, watts: 1500, groupId: "G11",
      wallId: "bath_right", x: 725, y: 1395, refSide: "right", offsetMm: 1200, heightMm: 300, byPencil: false, comment: "В сантехшкафу, УЗО 10 мА"
    },
    {
      id: "R29", stage: 2, room: "Санузел", title: "Регулятор тёплого пола санузла",
      kind: "thermo", sockets: 0, rj45: 0, ip44: false, watts: 450, groupId: "G10",
      wallId: "bath_entry", x: 769, y: 1475, refSide: "right", offsetMm: 410, heightMm: 900, byPencil: true, comment: "По выведенному датчику уже уложенного ТП"
    },
    {
      id: "R30", stage: 2, room: "Балкон", title: "Регулятор тёплого пола балкона",
      kind: "thermo", sockets: 0, rj45: 0, ip44: false, watts: 600, groupId: "G10",
      wallId: "balc_bot", x: 1595, y: 352, refSide: "left", offsetMm: 155, heightMm: 900, byPencil: true, comment: "По выведенному датчику уже уложенного ТП"
    },
    {
      id: "R31", stage: 2, room: "Балкон", title: "Балкон (одиночная 1×IP44+)",
      kind: "socket", sockets: 1, rj45: 0, ip44: true, watts: 500, groupId: "G13",
      wallId: "balc_bot", x: 1665, y: 352, refSide: "left", offsetMm: 590, heightMm: 300, byPencil: false, comment: "Посажена на Гр. 13 (отдельно от правой половины зала)"
    },
    {
      id: "R32", stage: 2, room: "Спальня", title: "Тумба 1: над тумбой (ось 855 мм, сдвиг 150 от света)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 150, groupId: "G14",
      wallId: "bed_right", x: 955, y: 1785, refSide: "left", offsetMm: 855, heightMm: 600, byPencil: false, comment: "Над тумбой на уровне нижнего поста света h=600"
    },
    {
      id: "R33", stage: 2, room: "Спальня", title: "Тумба 2: над тумбой (ось 855 мм, сдвиг 150 от света)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 150, groupId: "G14",
      wallId: "bed_right", x: 955, y: 2045, refSide: "right", offsetMm: 855, heightMm: 600, byPencil: false, comment: "Над тумбой на уровне нижнего поста света h=600"
    },
    {
      id: "R34", stage: 2, room: "Спальня", title: "Спальня напротив кровати (левая стена)",
      kind: "socket", sockets: 2, rj45: 0, ip44: false, watts: 300, groupId: "G14",
      wallId: "bed_left", x: 463, y: 1885, refSide: "right", offsetMm: 1560, heightMm: 300, byPencil: true, comment: "По карандашной разметке на стене"
    }
  ]
};
