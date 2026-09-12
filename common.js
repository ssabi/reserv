/**
 * LG 베스트샵 공통 UI 스크립트 (new_js/common.js)
 *
 * ## 모듈 구성
 * | 모듈            | 역할                                      |
 * |-----------------|-------------------------------------------|
 * | UiInit          | DOM 초기화 (sltBox, 캘린더, 스크롤 등)    |
 * | PopupManager    | 레이어 팝업 · dim 스택 · 포커스 트랩      |
 * | A11y            | 포커스 조회 · 선택 안내 · helper-text · placeholder |
 * | ImageMapManager | 반응형 이미지맵 coords 재계산             |
 * | MoGnbUI         | 모바일 전체 메뉴 dialog · 포커스 트랩     |
 * | PcGnb           | PC 메가메뉴 (initGnb)                     |
 * | Toolbar         | 모바일 하단 독바                          |
 * | SwiperA11y      | aria-live 제거 · 슬라이드 포커스 제어     |
 * | HeaderUI        | 스크롤 헤더 · 맨위로 로고 포커스          |
 * | StoreLocator    | 매장 찾기 탭 드롭다운                     |
 * | NaverMapA11y    | 지도 줌/InfoWindow 포커스 접근성          |
 * | DelegatedEvents | document 위임 이벤트 (1회 바인딩)         |
 *
 * ## 모듈 접근
 * - window.BestCommon — 초기화·스크롤·캘린더 등 단축 API
 * - window.BestCommon.Modules.{모듈명} — 그룹별 공개 API
 *
 * ## 사용법
 * - BestCommon.init(scope) — AJAX 삽입 DOM 수동 초기화
 * - MutationObserver — DOM 추가 시 initDom 자동 호출 (observeDynamicContent)
 *
 * ## 초기화 흐름 (유지보수 시 참고)
 * 1) $(document).ready → bindDelegatedEvents / PopupManager.init / initDom
 * 2) observeDynamicContent 등록 → bestshop AJAX childList 감지
 * 3) 노이즈(mCS·datepicker 등) 제외 후 스코프 또는 전체 initDom
 * 4) initDom 중 domSyncing=true + takeRecords() 로 Observer 재진입 차단
 *
 * ## 주의 (루프·누수)
 * - document/window 리스너·Observer는 *_Bound 플래그로 1회만 바인딩
 * - mCustomScrollbar updateOnContentResize 는 끄고, append 후 수동 update
 * - 탭 title="선택됨" 은 A11y strip (paymentDiscountBestlife 등과 정책 맞춤)
 */
(function ($, window, document) {
    'use strict';

    // =========================================================================
    // 공유 상태 · 상수
    // =========================================================================

    // --- 뷰포트 / 스크롤 ---
    var _thsW = $(window).width();
    var prevScTop = window.scrollY;
    var resizedSearch;

    // --- 매장찾기 MO 탭 드롭다운 ---
    var isTabOpen = false;
    var tabWrap = '.search-store-wrap .store-list .opt-wrap .tab-wrap';
    var moTabControlBtn = '.search-store-wrap .store-list .opt-wrap .btn-search-type';
    var header = '.header-wrap.mobile .header-mobile-top';

    // --- 팝업 스택 (onPopArr: 열린 팝업 키, onPopObj: onShow/onClose 등) ---
    var timer = null;
    var onPopArr = [];
    var onPopObj = {};
    var $popBtnInx;

    // --- 이벤트 네임스페이스 (off 시 충돌 방지) ---
    var FOCUS_TRAP_NS = '.bestPopupFocusTrap';
    var TOOLBAR_NS = '.toolbarInit';
    var MO_GNB_ANIM_NS = '.moGnbAnim';
    var MO_GNB_A11Y_NS = '.moGnbA11y';
    var MO_GNB_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

    // --- 1회 바인딩 가드 (중복 리스너·Observer 누수 방지) ---
    var toolbarBound = false;
    var moGnbDocumentBound = false;
    var delegatedEventsBound = false;
    var popupEventsBound = false;
    var dynamicContentObserver = null;
    var swiperAriaLiveObserver = null;
    /** initDom / A11y 동기화 중 — MutationObserver 재진입·루프 방지 */
    var domSyncing = false;

    // --- 환경 판별 (UA) — 공용 ---
    function isApp() {
        return /lgeapp/i.test(navigator.userAgent || '');
    }

    function isIOS() {
        var ua = navigator.userAgent || '';
        // if (/iPad|iPhone|iPod/.test(ua)) return true;
        // // iPadOS 13+ desktop UA
        // return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

        // 1. 일반적인 iPhone, iPod, 구형 iPad 감지
        const isBasicIOS = /(iPad|iPhone|iPod)/.test(navigator.userAgent || '');

        // 2. 데스크톱 모드로 위장한 신형 iPad 감지 (Mac인척 하지만 터치가 되는 기기)
        const isMacStyleIPad = (navigator.platform === 'MacIntel' || /Macintosh/.test(navigator.userAgent)) && navigator.maxTouchPoints > 1;

        return isBasicIOS || isMacStyleIPad;
    }

    function isAndroid() {
        return /Android/i.test(navigator.userAgent || '');
    }

    /** window.open / InAppBrowser 닫기 (앱 · 웹) */
    function closePopupWindow() {
        try { window.close(); } catch (err) { /* noop */ }

        if (isApp()) {
            try {
                if (isIOS()) {
                    var jsonString = JSON.stringify({'command':'closeNewInAppBrowser'});
                    webkit.messageHandlers.callbackHandler.postMessage(jsonString);
                } else if (window.android && typeof android.closeNewWebview === 'function') {
                    android.closeNewWebview();
                }
            } catch (err) { /* noop */ }
            return;
        }
    }

    /** @namespace MoGnbUI — 모바일 전체 메뉴 상태 (헤더 1개 기준) */
    var moGnb = {
        isOpen: false,
        $wrap: null,
        $menuItem: null,
        $trigger: null,
        $familySiteWrap: null,
        lastFocus: null,
        hiddenElements: [],
        disabledFocusables: [],
        focusRetryTimer: null,
        focusSettleTimer: null,
        closeByPointer: false,
        skipToolbarLock: false
    };

    /** jQuery UI datepicker 공통 옵션 (인라인·팝업 캘린더) */
    var DATEPICKER_OPTS = {
        closeText: '닫기',
        currentText: '오늘',
        prevText: '이전 달',
        nextText: '다음 달',
        monthNames: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
        monthNamesShort: ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'],
        dayNames: ['일', '월', '화', '수', '목', '금', '토'],
        dayNamesShort: ['일', '월', '화', '수', '목', '금', '토'],
        dayNamesMin: ['일', '월', '화', '수', '목', '금', '토'],
        weekHeader: '주',
        yearSuffix: '.',
        showMonthAfterYear: true,
        showOtherMonths: true,
        onSelect: function (dateText) {
            if (_thsW < 768) {
                $(this).closest('.calendar').removeClass('active');
            }
        }
        // aria-label / title 보정은 _updateDatepicker 훅에서 처리
        // (beforeShow·onChangeMonthYear는 HTML 재생성 이전에 호출되어 타이밍이 어긋남)
    };

    /**
     * BestCommon 공개 단축 API
     * - init: AJAX 후 수동 초기화 (MutationObserver와 동일 경로)
     * - Modules 는 파일 하단에서 할당
     */
    var BestCommon = {
        init: initDom,
        initSltBox: initSltBox,
        initCustomScroll: initCustomScroll,
        initBottomSheets: initBottomSheets,
        initCalendar: initCalendar,
        setCalendarAriaLabel: setCalendarAriaLabel,
        initImgMaps: initImgMaps,
        bindResponsiveImageMaps: bindResponsiveImageMaps,
        refreshResponsiveImageMaps: refreshResponsiveImageMaps,
        storeLocatorDefault: storeLocatorDefault,
        popupZIndex: updatePopupZIndex,
        isApp: isApp,
        isIOS: isIOS,
        isAndroid: isAndroid,
        closePopupWindow: closePopupWindow
    };

    // =========================================================================
    // 초기화 진입점 (정적·동적 DOM 공통)
    // =========================================================================

    /** $scope 가 있으면 해당 루트, 없으면 document */
    function getRoot($scope) {
        return $scope && $scope.length ? $scope : $(document);
    }

    /**
     * DOM 컴포넌트·접근성 일괄 초기화
     * @param {jQuery} [$scope] - 없으면 전체 document / 있으면 AJAX 조각만
     *
     * 호출 경로
     * - ready 시 1회 (전체)
     * - observeDynamicContent (AJAX childList)
     * - BestCommon.init($scope) 수동 호출 (eventStoreList 등)
     *
     * 가드
     * - domSyncing 중 재진입 차단
     * - finally 에서 Observer takeRecords() 로 자체 DOM 변경분 폐기
     */
    function initDom($scope) {
        if (domSyncing) return;
        domSyncing = true;

        try {
            var $root = getRoot($scope);
            // bestshop AJAX 조각 init 시 GNB/툴바 전체 재스캔 생략
            var isFullDoc = !$scope || !$scope.length;

            // UiInit — 폼·탭·스크롤 등 컴포넌트
            UiInit.sltBox($root);
            UiInit.customScroll($root);
            UiInit.bottomSheets($root);
            UiInit.calendar($root);
            UiInit.imgMaps($root);
            UiInit.textfieldState($root);
            UiInit.subTabType1Nav($root);
            UiInit.checkBoxControl($root);
            A11y.enhanceTextareaPlaceholders($root);
            A11y.enhanceHelperTextLive($root);
            A11y.enhanceShareKakaoTitle($root);
            A11y.ensureContentId($root);
            A11y.relocatePopupCloseButtons($root);
            A11y.syncListVisittDoneAnnouncements($root);
            A11y.syncTabA11y($root);

            // 페이지 이동형 탭 — 활성 탭이 가로 스크롤/Swiper 밖이면 로드 후 보이게
            scheduleScrollActiveTabsIntoView($root, isFullDoc);

            // PopupManager · GNB · Toolbar · Swiper
            PopupManager.updateZIndex($root);
            SwiperA11y.removeWrapperAriaLive($root[0] || document);

            if (isFullDoc) {
                storeLocatorDefault();
                initGnb();
                Toolbar.init();
                bottomFixButton();
            } else {
                if ($root.find('.header').add($root.filter('.header')).length) {
                    initGnb($root);
                }
                bottomFixButton();
            }
        } finally {
            // initDom이 만든 childList/attribute 변경은 동적 DOM 관찰에서 제외
            if (dynamicContentObserver) dynamicContentObserver.takeRecords();
            if (A11y._tabSelectedTitleObserver) A11y._tabSelectedTitleObserver.takeRecords();
            if (A11y._listVisittDoneObserver) A11y._listVisittDoneObserver.takeRecords();
            if (swiperAriaLiveObserver) swiperAriaLiveObserver.takeRecords();
            domSyncing = false;
        }
    }

    // -------------------------------------------------------------------------
    // UiInit 보조 — 서브탭 type1 인디케이터
    // -------------------------------------------------------------------------

    /** .sub-tab-wrap.type1 의 .nav-bg 를 활성 li 위치에 맞춤 */
    function updateSubTabType1NavBg($wrap) {
        var $tabs = $wrap.find('.tabs');
        var $navBg = $wrap.find('.nav-bg');
        var $on = $tabs.children('li.on');

        if (!$navBg.length) return;

        if (!$on.length) {
            $navBg.hide();
            return;
        }

        var wrapRect = $wrap[0].getBoundingClientRect();
        var onRect = $on[0].getBoundingClientRect();

        $navBg.show().css({
            left: onRect.left - wrapRect.left,
            top: onRect.top - wrapRect.top,
            width: onRect.width,
            height: onRect.height,
            bottom: 'auto'
        });
    }

    /** 레이아웃 안정화 후 nav-bg 갱신 (더블 rAF) */
    function scheduleUpdateSubTabType1NavBg($wrap) {
        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                updateSubTabType1NavBg($wrap);
            });
        });
    }

    /** .sub-tab-wrap.type1 최초 1회: nav-bg 삽입 + 위치 동기화 */
    function initSubTabType1Nav($scope) {
        getRoot($scope).find('.sub-tab-wrap.type1').not('[data-type1-nav-init]').each(function () {
            var $wrap = $(this);

            $wrap.attr('data-type1-nav-init', 'true');

            if (!$wrap.find('.nav-bg').length) {
                $wrap.append('<span class="nav-bg" aria-hidden="true"></span>');
            }

            scheduleUpdateSubTabType1NavBg($wrap);

            if (document.fonts && document.fonts.ready) {
                document.fonts.ready.then(function () {
                    updateSubTabType1NavBg($wrap);
                });
            }
        });
    }

    /** 활성 탭(li.on / aria-current)을 가로 스크롤·Swiper 가시 영역으로 맞춤 */
    function scrollActiveTabsIntoView($scope, waitSwiper) {
        var done = [];
        getRoot($scope).find("[class*='tab-wrap'] .tabs > li.on")
            .add(getRoot($scope).find("[class*='tab-wrap'] .tabs > li > a[aria-current='page']").parent())
            .each(function () {
                var li = this;
                if (!li.isConnected || done.indexOf(li) > -1) return;
                done.push(li);

                var $li = $(li);
                var host = $li.closest('.sub-tab-wrap.swiper, [class*="tab-wrap"].swiper')[0];
                if (host) {
                    var sw = host.swiper;
                    if (sw && typeof sw.slideTo === 'function') {
                        var idx = sw.slides ? Array.prototype.indexOf.call(sw.slides, li) : -1;
                        if (idx < 0) idx = $li.index();
                        if (idx >= 0 && sw.activeIndex !== idx) sw.slideTo(idx, 0, false);
                        return;
                    }
                    if (waitSwiper) return;
                }

                var box = $li.closest('.tab-wrap.flexible-tab')[0]
                    || ($li.parent().is('.tabs') ? $li.parent()[0] : null)
                    || $li.closest('.tab-sub').children('ul')[0];
                if (!box || box.scrollWidth <= box.clientWidth + 1) return;

                var c = box.getBoundingClientRect();
                var r = li.getBoundingClientRect();
                if (r.left >= c.left - 1 && r.right <= c.right + 1) return;

                var next = r.left - c.left + box.scrollLeft - (box.clientWidth - r.width) / 2;
                box.scrollLeft = Math.max(0, Math.min(next, box.scrollWidth - box.clientWidth));
            });
    }

    var _tabScrollTimer = null;

    /** 레이아웃 1회 →(필요 시) Swiper 초기화 후 1회 */
    function scheduleScrollActiveTabsIntoView($scope, withRetry) {
        if (_tabScrollTimer) clearTimeout(_tabScrollTimer);
        window.requestAnimationFrame(function () {
            scrollActiveTabsIntoView($scope, true);
            if (!withRetry) {
                scrollActiveTabsIntoView($scope, false);
                return;
            }
            _tabScrollTimer = setTimeout(function () {
                _tabScrollTimer = null;
                scrollActiveTabsIntoView($scope, false);
            }, 250);
        });
    }

    /** .sltBox — ARIA·active 초기화 (data-slt-init 로 중복 방지) */
    function initSltBox($scope) {
        getRoot($scope).find('.sltBox').not('[data-slt-init]').each(function () {
            var $slt = $(this);
            $slt.attr('data-slt-init', 'true');

            if ($slt.is('.border-type')) {
                $slt.find('select').addClass('base-slt');
            }
            $slt.find('> ul > li:first-of-type').addClass('active');

            var $btn = $slt.find('.btn-slt');
            if ($btn.length) {
                if (!$btn.attr('role')) $btn.attr('role', 'button');
                $btn.attr('aria-expanded', $slt.hasClass('on') ? 'true' : 'false');
            }
            $slt.find('ul > li > a').not('.btn-slt').each(function () {
                if (!$(this).attr('role')) $(this).attr('role', 'button');
            });
        });
    }

    /** .input-wrap 클리어 버튼 표시·aria-label */
    function initTextfieldState($scope) {
        getRoot($scope).find('.input-wrap input:not([readonly], [disabled])').each(function () {
            var $input = $(this);
            var $clear = $input.siblings('.btn-clear');
            if (!$clear.length) return;
            if (!$clear.attr('aria-label')) $clear.attr('aria-label', '입력 내용 지우기');
            $clear.toggle($input.val().length > 0);
        });

        if ($(moTabControlBtn).length && !$(moTabControlBtn).attr('aria-expanded')) {
            $(moTabControlBtn).attr('aria-expanded', isTabOpen ? 'true' : 'false');
        }
    }

    /** .check-wrap 체크박스 — Enter 키로 checked 토글 (Space는 브라우저 기본 동작) */
    function initcheckBoxControl($scope) {
        getRoot($scope).find('.check-wrap input[type="checkbox"]:not([disabled])').not('[data-check-key-init]').each(function () {
            var input = this;

            input.setAttribute('data-check-key-init', 'true');

            input.addEventListener('keydown', function (e) {
                if (e.key !== 'Enter' && e.keyCode !== 13) return;

                e.preventDefault();
                input.checked = !input.checked;
                $(input).trigger('change');
            });
        });
    }

    // 텍스트 카운트 접근성 (data-txt-count-init 로 중복 append 방지)
    function initTextCount($scope) {
        getRoot($scope).find('.txt-count').not('[data-txt-count-init]').each(function (idx) {
            var $txtCount = $(this);
            var $textarea = $txtCount.siblings('div').find('input, textarea');

            if (!$textarea.length) return;

            $txtCount.attr('data-txt-count-init', 'true');
            $txtCount.attr('id', 'txtCount_' + idx);
            $txtCount.attr('aria-live', 'polite');
            $txtCount.find('.txt-count-num').before('<span class="blind">현재</span>');
            $txtCount.find('.txt-count-num').after('<span class="blind">자</span>');
            $txtCount.append('<span class="blind">자 제한</span>');
            $textarea.attr('aria-describedby', 'txtCount_' + idx);
        });
    }

    function getCustomScrollBreakpoint(breakpoint) {
        if (breakpoint != null && !isNaN(breakpoint)) return breakpoint;
        var attr = document.body && document.body.getAttribute('data-custom-scroll-breakpoint');
        return attr ? parseInt(attr, 10) : 767;
    }

    /**
     * .custom-scroll — PC: mCustomScrollbar / MO: 네이티브
     * - bestshop(eventStoreList 등)이 AJAX 후 BestCommon.initCustomScroll 호출
     * - updateOnContentResize:false → Observer↔initDom 루프 방지
     * - update 구간은 domSyncing + takeRecords 로 가드
     */
    function initCustomScroll(breakpoint, $scope) {
        var bp = getCustomScrollBreakpoint(breakpoint);
        var winW = $(window).width();
        var isPc = winW > bp;
        var $targets = getRoot($scope).find('.custom-scroll');
        if (!$targets.length) return;

        // mCS DOM 변경이 dynamicContentObserver → initDom 재진입하지 않도록 가드
        var wasSyncing = domSyncing;
        domSyncing = true;

        try {
            $targets.each(function () {
                var $el = $(this);

                if (isPc) {
                    if ($el.data('mCS')) {
                        $el.mCustomScrollbar('update');
                        return;
                    }
                    if ($el.find('.mCSB_container').length) {
                        try { $el.mCustomScrollbar('destroy'); } catch (e) {}
                    }
                    // updateOnContentResize:true 는 AJAX 리스트와 맞물려 childList 루프를 유발할 수 있음
                    // bestshop은 append 후 initCustomScroll을 호출하므로 수동 update로 충분
                    $el.mCustomScrollbar({
                        mouseWheelPixels: 140,
                        scrollInertia: 300,
                        advanced: { updateOnContentResize: false }
                    });
                } else {
                    if ($el.data('mCS')) {
                        $el.mCustomScrollbar('destroy');
                    }
                    $el.css('-webkit-overflow-scrolling', 'touch');
                }
            });

            if (isPc) {
                window.requestAnimationFrame(function () {
                    var nestedWasSyncing = domSyncing;
                    domSyncing = true;
                    try {
                        $targets.each(function () {
                            var $el = $(this);
                            if ($el.data('mCS')) $el.mCustomScrollbar('update');
                        });
                    } finally {
                        if (dynamicContentObserver) dynamicContentObserver.takeRecords();
                        if (!nestedWasSyncing) domSyncing = false;
                    }
                });
            }
        } finally {
            if (dynamicContentObserver) dynamicContentObserver.takeRecords();
            if (!wasSyncing) domSyncing = false;
        }
    }

    // -------------------------------------------------------------------------
    // Calendar — jQuery UI datepicker 접근성 · 날짜 선택 후 초점 복원
    // -------------------------------------------------------------------------

    function getDatepickerInst(el) {
        var node = el && el.jquery ? el[0] : el;
        if (!node || !$.datepicker) return null;
        return $.datepicker._getInst(node);
    }

    function getDatepickerCellDate(inst, cellIndex) {
        var drawYear = inst.drawYear;
        var drawMonth = inst.drawMonth;
        var firstDayOfMonth = new Date(drawYear, drawMonth, 1);
        var firstDaySetting = inst.settings.firstDay != null ? inst.settings.firstDay : $.datepicker._defaults.firstDay;
        var dayOffset = (firstDayOfMonth.getDay() - firstDaySetting + 7) % 7;
        var day = 1 - dayOffset + cellIndex;
        return new Date(drawYear, drawMonth, day);
    }

    /**
     * datepicker 렌더 완료 후 접근성 보정
     * - 선택 가능 날짜(a.ui-state-default) aria-label (오늘이면 '오늘' 추가)
     * - span.ui-state-default(선택 불가 등) 은 AT 포커스·낭독 제외
     * - 요일 th span title 제거
     * - prev/next 헤더 링크 href 보정
     * - 비활성 prev/next(ui-state-disabled) tabindex/aria-hidden 보정
     * - .noLiveDay 안 a 탭 이동 차단
     */
    function setCalendarAriaLabel(instOrEl) {
        var inst = instOrEl && instOrEl.dpDiv ? instOrEl : getDatepickerInst(instOrEl);
        if (!inst || !inst.dpDiv) return;

        var $calendar = $(inst.dpDiv);
        if (!$calendar.length) return;

        $calendar.find('tbody td').each(function (cellIndex) {
            var $td = $(this);
            var $item = $td.find('.ui-state-default').first();
            if (!$item.length) return;

            // a 가 아닌 span 노출(비선택·다른달 등) — 스크린리더 포커스 방지
            if ($item.is('span')) {
                $item.removeAttr('aria-label tabindex').attr('aria-hidden', 'true');
                return;
            }

            var date = getDatepickerCellDate(inst, cellIndex);
            var year = date.getFullYear();
            var month = date.getMonth() + 1;
            var day = date.getDate();
            var label = year + '년 ' + month + '월 ' + day + '일';

            // 오늘 날짜(ui-datepicker-today)는 aria-label 뒤에 '오늘' 안내
            if ($td.hasClass('ui-datepicker-today')) {
                label += ' 오늘';
            }

            $item.removeAttr('aria-hidden').attr('aria-label', label);
        });

        $calendar.find('thead th span').removeAttr('title');
        $calendar.find('.ui-widget-header a').attr('href', 'javascript:void(0);');

        $calendar.find('.ui-datepicker-header .ui-datepicker-prev, .ui-datepicker-header .ui-datepicker-next').each(function () {
            var $nav = $(this);
            if ($nav.hasClass('ui-state-disabled')) {
                $nav.attr({ tabindex: '-1', 'aria-hidden': 'true' });
            } else {
                $nav.removeAttr('tabindex aria-hidden');
            }
        });

        $calendar.find('td.noLiveDay a').attr({ tabindex: '-1', 'aria-hidden': 'true' });
    }

    /**
     * 캘린더 재렌더 전 포커스 위치 파악 (날짜 선택·월 이동 시 초점 유지용)
     */
    function getDatepickerFocusRestoreKey(inst) {
        var dpEl = inst && inst.dpDiv && inst.dpDiv[0];
        var active = document.activeElement;
        if (!dpEl || !active || !dpEl.contains(active)) return null;

        var $active = $(active);
        if ($active.closest('.ui-datepicker-prev').length) return 'prev';
        if ($active.closest('.ui-datepicker-next').length) return 'next';
        // 날짜 셀(선택 직전·선택됨) → 재렌더 후 선택일로 복원
        if ($active.closest('td').length || $active.hasClass('ui-state-default')) return 'selected';
        return 'selected';
    }

    function restoreDatepickerFocus(inst, restoreKey) {
        if (!restoreKey || !inst || !inst.dpDiv) return;

        var $dp = $(inst.dpDiv);
        var $target = $();

        if (restoreKey === 'prev') {
            $target = $dp.find('.ui-datepicker-prev:not(.ui-state-disabled)');
        } else if (restoreKey === 'next') {
            $target = $dp.find('.ui-datepicker-next:not(.ui-state-disabled)');
        } else {
            $target = $dp.find('td.ui-datepicker-current-day a.ui-state-default, a.ui-state-active').first();
        }

        if ($target.length) $target.focus();
    }

    /**
     * jQuery UI가 캘린더 HTML을 다시 그린 직후(_updateDatepicker)에 보정 실행.
     * setTimeout으로는 렌더 완료를 보장할 수 없어 훅으로 처리.
     */
    function bindDatepickerA11yHook() {
        if (!$.datepicker || $.datepicker._bestA11yHooked) return;
        $.datepicker._bestA11yHooked = true;

        // 날짜 클릭/터치 시 셀에 포커스가 없을 수 있어 _selectDay에서 복원 키를 남김
        var _selectDay = $.datepicker._selectDay;
        $.datepicker._selectDay = function (id, month, year, td) {
            $.datepicker._bestFocusRestore = 'selected';
            return _selectDay.apply(this, arguments);
        };

        var _updateDatepicker = $.datepicker._updateDatepicker;
        $.datepicker._updateDatepicker = function (inst) {
            var restoreKey = $.datepicker._bestFocusRestore || getDatepickerFocusRestoreKey(inst);
            $.datepicker._bestFocusRestore = null;

            _updateDatepicker.apply(this, arguments);
            setCalendarAriaLabel(inst);
            restoreDatepickerFocus(inst, restoreKey);
        };
    }

    function initCalendar($scope) {
        bindDatepickerA11yHook();

        // getRoot($scope).find('#calendar').not('[data-calendar-init]').each(function () {
        getRoot($scope).find('#calendar, .calendar-wrap').not('[data-calendar-init]').each(function () {
            var $cal = $(this);
            $cal.attr('data-calendar-init', 'true');

            let customOptions = {};

            let customMinDate = $cal.data('minDate');
            if(customMinDate) customOptions.minDate = customMinDate;

            let customMaxDate = $cal.data('maxDate');
            if(customMaxDate) customOptions.maxDate = customMaxDate;

            let customDateFormat = $cal.data('dateFormat');
            if(customDateFormat) customOptions.dateFormat = customDateFormat;

            let datepickOptions = Object.assign({}, DATEPICKER_OPTS, customOptions);

            $cal.datepicker(datepickOptions);
            // inline 초기화 시 _updateDatepicker 훅에서 접근성 보정 완료
        });
        // datepicker 위젯이 body에 붙는 경우 헤더 링크 보정
        $('.ui-widget-header a').attr('href', 'javascript:void(0);');
    }

    function initImgMaps($scope) {
        linkOrphanImageMaps($scope);
        bindResponsiveImageMaps($scope);
    }

    /** img 바로 다음에 map만 있고 name이 없을 때 usemap/name 연결 */
    function linkOrphanImageMaps($scope) {
        getRoot($scope).find('img[usemap]').each(function (index) {
            var img = this;
            var $next = $(img).next();
            if (!$next.length || $next.prop('tagName') !== 'MAP') return;

            var mapEl = $next[0];
            var usemap = img.getAttribute('usemap') || '';
            var mapName = usemap.replace(/^#/, '');

            if (!mapEl.getAttribute('name')) {
                if (!mapName) {
                    mapName = 'rwdMap_' + index + '_' + Date.now();
                }
                mapEl.setAttribute('name', mapName);
                img.setAttribute('usemap', '#' + mapName);
            }
        });
    }

    function initBottomSheets($scope) {
        getRoot($scope).find('.bottomSheet').not('[data-bottom-sheet-init]').each(function () {
            var sheet = this;
            sheet.setAttribute('data-bottom-sheet-init', 'true');
            bindBottomSheet(sheet);
        });
    }

    /**
     * @namespace UiInit
     * DOM 컴포넌트 초기화 묶음 (initDom에서 호출)
     * 각 함수는 data-*-init 마커로 동일 요소 재초기화를 막음
     */
    var UiInit = {
        sltBox: initSltBox,
        customScroll: initCustomScroll,
        bottomSheets: initBottomSheets,
        calendar: initCalendar,
        imgMaps: initImgMaps,
        textfieldState: initTextfieldState,
        subTabType1Nav: initSubTabType1Nav,
        checkBoxControl: initcheckBoxControl,
        scrollActiveTabs: scheduleScrollActiveTabsIntoView
    };

    // =========================================================================
    // PopupManager — 레이어 팝업 · dim 스택 · z-index
    // - Base.Ui.showPopup / popDisplayBlock · popDisplayClose 와 연동
    // - onPopArr 스택: dim ↔ popup 교차 z-index
    // =========================================================================

    var POPUP_DIM_ATTR = 'data-popup-dim';

    function getDimZIndex() {
        return window.innerWidth > 767 ? 1000 : 9000;
    }

    function getPopupZBase() {
        return getDimZIndex() + 1;
    }

    function normalizePopupKey(target) {
        if (!target) return target;
        if (typeof target !== 'string') {
            return target.id ? '#' + target.id : target;
        }
        return target.charAt(0) === '#' ? target : '#' + target;
    }

    function getPopupDims() {
        return $('body > .dim[' + POPUP_DIM_ATTR + ']');
    }

    function createPopupDim() {
        return $('<div class="dim" aria-hidden="true"></div>').attr(POPUP_DIM_ATTR, 'true');
    }

    function ensurePopupDimStack(count) {
        $('body > .dim:not([' + POPUP_DIM_ATTR + '])').remove();

        var $dims = getPopupDims();

        while ($dims.length < count) {
            $('body').append(createPopupDim().css('display', 'none'));
            $dims = getPopupDims();
        }
    }

    function trimPopupDimStack(count) {
        var $dims = getPopupDims();

        while ($dims.length > count) {
            $dims.last().remove();
            $dims = getPopupDims();
        }
    }

    // toast, main-banner 팝업 체크
    function isToastPopup(selector) {
        return $(selector).hasClass('toast') || $(selector).hasClass('main-banner');
    }

    function getLayerPopupCount(list) {
        list = list || onPopArr;
        return list.filter(function (selector) {
            return !isToastPopup(selector);
        }).length;
    }

    /** 열린 팝업 스택: dim(0) > popup(0) > dim(1) > popup(1) ... (.toast는 dim 없음) */
    function syncPopupLayers() {
        if (!onPopArr.length) {
            getPopupDims().remove();
            return;
        }

        var dimCount = getLayerPopupCount();

        ensurePopupDimStack(dimCount);
        trimPopupDimStack(dimCount);

        var $dims = getPopupDims();
        var z = getDimZIndex();
        var dimIdx = 0;

        onPopArr.forEach(function (selector) {
            var $popup = $(selector);

            if (isToastPopup(selector)) {
                $popup.css('z-index', z);
                z += 1;
                return;
            }

            $dims.eq(dimIdx).css({
                display: 'block',
                zIndex: z
            });
            z += 1;
            $popup.css('z-index', z);
            z += 1;
            dimIdx += 1;
        });
    }

    function openPopupDim() {
        var dimLevel = getLayerPopupCount() - 1;

        ensurePopupDimStack(dimLevel + 1);
        getPopupDims().eq(dimLevel).attr('aria-hidden', 'true').stop(true, true).fadeIn(100);
        syncPopupLayers();
    }

    function updatePopupZIndex($scope) {
        var popBase = getPopupZBase();
        getRoot($scope).find('.popup').each(function (index) {
            var $popup = $(this);
            var popupKey = '#' + $popup.attr('id');

            if (onPopArr.indexOf(popupKey) > -1) return;

            $popup.css('z-index', popBase + index);
        });
    }

    // -------------------------------------------------------------------------
    // Textarea 글자 수 (위임 + 초기값)
    // -------------------------------------------------------------------------

    function updateTxtCount($textarea) {
        var $wrap = $textarea.closest('.input-wrap');
        var $target = $wrap.find('.txt-count');
        if (!$target.length) return;

        var maxNum = 1000;
        var maxLength = parseInt($textarea.attr('maxlength'), 10) || maxNum;
        var textLength = $textarea.val().length;

        if (textLength > maxLength) {
            $textarea.val($textarea.val().substring(0, maxLength));
            textLength = maxLength;
        }
        $target.find('.txt-count-num').text(textLength);
    }

    // =========================================================================
    // A11y — 포커스 조회 · 선택 안내 · textarea placeholder
    // - bindSelectionAnnouncements: form-check / list_manager / list-visitt
    // - syncTabA11y: 탭 title·tabpanel aria-select 정리 (초기·AJAX 공통)
    // - stripTabSelectedTitle: paymentDiscountBestlife 등이 title="선택됨" 재설정 시 제거
    // =========================================================================

    var A11y = {
        FOCUSABLE_SELECTOR: [
            'a[href]',
            'button:not([disabled])',
            'input:not([disabled]):not([type="hidden"])',
            'textarea:not([disabled])',
            'select:not([disabled])',
            '[tabindex]:not([tabindex="-1"])'
        ].join(', '),

        /** 컨테이너 내 보이는 포커스 가능 요소 */
        getFocusable: function ($container) {
            return $container.find(this.FOCUSABLE_SELECTOR).filter(':visible');
        },

        /**
         * 선택 상태 스크린리더 안내 (blind '선택됨')
         * - button.form-check-btn (단일·다중)
         * - .list_manager li a
         * - .list-visitt > li.done (title="선택됨")
         * - 탭 링크 title="선택됨" 제거 (모듈이 다시 넣어도 제거)
         */
        bindSelectionAnnouncements: function () {
            if (this._selectionAnnouncementsBound) return;
            this._selectionAnnouncementsBound = true;

            var NS = '.bestA11ySelect';

            $(document).on('click' + NS, 'button.form-check-btn', function () {
                $(this).parent().find('button.form-check-btn').each(function () {
                    $(this).children('span.blind').remove();
                    if ($(this).hasClass('on')) {
                        $(this).append('<span class="blind">선택됨</span>');
                    }
                });
            });

            $(document).on('click' + NS, '.list_manager li a', function () {
                $(this).parents('div').find('span.blind').remove();
                if ($(this).parents('li').hasClass('on')) {
                    $(this).append('<span class="blind">선택됨</span>');
                }
            });

            if (window.MutationObserver && !this._listVisittDoneObserver) {
                this._listVisittDoneObserver = new MutationObserver(function (mutations) {
                    if (domSyncing) return;

                    mutations.forEach(function (mutation) {
                        var el = mutation.target;
                        if (mutation.type !== 'attributes' || mutation.attributeName !== 'class') return;
                        if (!el || !el.matches || !el.matches('.list-visitt > li')) return;
                        A11y.syncListVisittDoneItem(el);
                    });
                });
                this._listVisittDoneObserver.observe(document.body, {
                    attributes: true,
                    attributeFilter: ['class'],
                    subtree: true
                });
            }

            this.bindTabSelectedTitleStrip();
        },

        /**
         * 탭 링크의 title="선택됨" 제거
         * - activateTabItem의 removeAttr('title')과 동일 정책
         * - paymentDiscountBestlife 등에서 capture로 title을 다시 넣어도 제거
         */
        stripTabSelectedTitle: function (el) {
            if (domSyncing || this._tabTitleStripSyncing) return;
            if (!el || !el.getAttribute || el.getAttribute('title') !== '선택됨') return;
            if (!el.closest || !el.closest("[class*='tab-wrap'] .tabs > li")) return;

            this._tabTitleStripSyncing = true;
            el.removeAttribute('title');
            this._tabTitleStripSyncing = false;
        },

        /**
         * UI 탭용 의사 링크 여부 (#none / javascript:void(0))
         * - false 이면 페이지 이동형 탭 → role=tab / aria-selected 대신 a에 aria-current
         */
        isUiTabPseudoHref: function (href) {
            if (href == null) return true;
            var h = String(href).replace(/\s+/g, '').toLowerCase();
            return h === '#none'
                || h === 'javascript:void(0)'
                || h === 'javascript:void(0);'
                || h === 'javascript:;';
        },

        /** a 안 '선택됨' blind 스팬 */
        getTabSelectedBlind: function ($a) {
            return $a.find('span.blind').filter(function () {
                return $.trim($(this).text()) === '선택됨';
            });
        },

        /**
         * 페이지 이동형 탭(li) 접근성 동기화
         * - role="tab" / aria-selected 제거
         * - li.on → a에 aria-current="page" (선택됨 blind 는 사용하지 않음)
         * @returns {boolean} 페이지 이동형이면 true
         */
        syncPageNavTabLi: function ($li) {
            var $a = $li.children('a').first();
            if (!$a.length) return false;
            if (this.isUiTabPseudoHref($a.attr('href'))) return false;

            if ($a.attr('role') === 'tab') $a.removeAttr('role');
            if ($a.is('[aria-selected]')) $a.removeAttr('aria-selected');
            // 잘못 li 에 남아 있으면 정리
            if ($li.is('[aria-current]')) $li.removeAttr('aria-current');

            // aria-current 와 중복되는 선택됨 안내 제거
            var $blind = this.getTabSelectedBlind($a);
            if ($blind.length) $blind.remove();

            if ($li.hasClass('on')) {
                if ($a.attr('aria-current') !== 'page') $a.attr('aria-current', 'page');
            } else if ($a.is('[aria-current]')) {
                $a.removeAttr('aria-current');
            }

            return true;
        },

        /**
         * 탭 접근성 초기/동기화
         * - 탭 링크 title 제거
         * - 페이지 이동형 탭: role/aria-selected → a에 aria-current="page"
         * - aria-controls 대상 [role="tabpanel"] 의 aria-select / aria-selected 제거
         */
        syncTabA11y: function ($scope) {
            var self = this;
            var $root = getRoot($scope);
            var $tabLis = $root.find("[class*='tab-wrap'] .tabs > li");
            var $tabLinks = $tabLis.children('a');

            // 이미 없는 속성은 건드리지 않아 Mutation 반복을 줄임
            $tabLinks.filter('[title]').removeAttr('title');

            $tabLis.each(function () {
                self.syncPageNavTabLi($(this));
            });

            $tabLinks.filter('[aria-controls]').each(function () {
                var controls = $(this).attr('aria-controls');
                if (!controls) return;

                var $target = $('#' + controls);
                if (!$target.length) return;

                $target.add($target.siblings())
                    .filter('[role="tabpanel"]')
                    .filter('[aria-select], [aria-selected]')
                    .removeAttr('aria-select aria-selected');
            });
        },

        bindTabSelectedTitleStrip: function () {
            if (!window.MutationObserver || this._tabSelectedTitleObserver) return;

            this._tabSelectedTitleObserver = new MutationObserver(function (mutations) {
                if (domSyncing || A11y._tabTitleStripSyncing) return;

                mutations.forEach(function (mutation) {
                    if (mutation.type !== 'attributes' || mutation.attributeName !== 'title') return;
                    A11y.stripTabSelectedTitle(mutation.target);
                });
            });
            this._tabSelectedTitleObserver.observe(document.body, {
                attributes: true,
                attributeFilter: ['title'],
                subtree: true
            });
        },

        /** .list-visitt > li.done → title="선택됨" 동기화 */
        syncListVisittDoneItem: function (li) {
            var $li = $(li);
            var $host = $li.children('a').first();
            if (!$host.length) $host = $li;

            var $blind = $li.find('span.blind').filter(function () {
                return $.trim($(this).text()) === '선택됨';
            });
            if ($blind.length) $blind.remove();

            if ($li.hasClass('done')) {
                if ($host.attr('title') !== '선택됨') $host.attr('title', '선택됨');
            } else if ($host.attr('title') === '선택됨') {
                $host.removeAttr('title');
            }
        },

        syncListVisittDoneAnnouncements: function ($scope) {
            var self = this;
            getRoot($scope).find('.list-visitt > li').each(function () {
                self.syncListVisittDoneItem(this);
            });
        },

        /** textarea[maxlength] placeholder에 (최대 N자) 보강 */
        enhanceTextareaPlaceholders: function ($scope) {
            getRoot($scope).find('textarea[maxlength]').not('[data-a11y-placeholder]').each(function () {
                var $ta = $(this);
                var maxLen = $ta.attr('maxlength');
                var placeholder = $ta.attr('placeholder') || '';
                if (!maxLen || placeholder.indexOf('최대') !== -1) {
                    $ta.attr('data-a11y-placeholder', 'true');
                    return;
                }
                $ta.attr('placeholder', placeholder + (placeholder ? ' ' : '') + '(최대 ' + maxLen + '자)');
                $ta.attr('data-a11y-placeholder', 'true');
            });
        },

        /** .helper-text 에 role="log", aria-live="polite" 부여 */
        enhanceHelperTextLive: function ($scope) {
            getRoot($scope).find('.helper-text').not('[data-helper-live]').attr({
                role: 'log',
                'aria-live': 'polite',
                'data-helper-live': 'true'
            });
        },

        /** .share-kakao a 에 title="새 창 열림" 부여 */
        enhanceShareKakaoTitle: function ($scope) {
            getRoot($scope).find('a.share-kakao').each(function () {
                if (this.getAttribute('title') !== '새 창 열림') {
                    this.setAttribute('title', '새 창 열림');
                }
            });
        },

        /**
         * id="content" 초기 부여 (skipToContent 연동)
         * - 페이지에 #content 가 없을 때만
         * - #affiliateDiscountListWrap.container → 자식 .content 에 부여
         * - 그 외 id 없는 첫 .container 에 부여
         */
        ensureContentId: function ($scope) {
            if (document.getElementById('content')) return;

            var $root = getRoot($scope);
            var $affiliate = $root.filter('.container#affiliateDiscountListWrap')
                .add($root.find('.container#affiliateDiscountListWrap'))
                .first();

            if ($affiliate.length) {
                var $inner = $affiliate.children('.content').filter(function () {
                    return !this.id;
                }).first();
                if ($inner.length) $inner.attr('id', 'content');
                return;
            }

            var $container = $root.filter('.container').add($root.find('.container')).filter(function () {
                return !this.id;
            }).first();

            if ($container.length) {
                $container.attr('id', 'content');
            }
        },

        /**
         * .popup-header 안의 .btn-close 이동
         * - .event-winner-popup → .event-winner-dialog
         * - 그 외 → 가장 가까운 래퍼(.pop-wrap / .popup-wrap)
         *   (.popup-wrap 안 레이어는 .pop-wrap으로 이동해야 창 전체가 닫히지 않음)
         */
        relocatePopupCloseButtons: function ($scope) {
            getRoot($scope).find('.popup .popup-header .btn-close, .popup-wrap .popup-header .btn-close').each(function () {
                var $btn = $(this);
                if (!$btn.parent().is('.popup-header')) return;

                var $popup = $btn.closest('.popup');
                var $popupWrap = $btn.closest('.popup-wrap');
                var $target;

                if ($popupWrap.hasClass('event-winner-popup') || $popup.hasClass('event-winner-popup')) {
                    $target = ($popupWrap.length ? $popupWrap : $popup).find('.event-winner-dialog').first();
                } else {
                    $target = $btn.closest('.pop-wrap, .popup-wrap');
                }

                if (!$target.length) return;
                $target.append($btn);
            });
        }
    };

    // -------------------------------------------------------------------------
    // PopupManager — 포커스 트랩 · 열기/닫기 · toast
    // (dim/z-index 유틸은 위 섹션, 공개 API는 PopupManager 객체)
    // -------------------------------------------------------------------------

    /**
     * 레이어 팝업 포커스 트랩
     * - Tab마다 focusable을 다시 계산 (달력·시간 라디오 등 동적 DOM 대응)
     * - 오픈 시 포커스되는 팝업 컨테이너(tabindex=0)도 순환에 포함
     * - toast 메시지처럼 목록 밖 현재 포커스(tabindex=-1 등)도 순환에 포함
     * - toast/GNB 포커스 루프 버튼은 Tab 순환에서 제외 (스와이프용)
     */
    function bindLayerFocusTrap($popup) {
        unbindLayerFocusTrap();

        if (!$popup || !$popup.length) return;

        $popup.on('keydown' + FOCUS_TRAP_NS, function (e) {
            if (e.key !== 'Tab' && e.keyCode !== 9) return;

            var popupEl = $popup[0];
            var $focusable = A11y.getFocusable($popup)
                .not('.mo-gnb-focus-loop, .mo-gnb-sentinel');

            // 팝업 루트에 tabindex가 있으면 순환에 포함 (document 순서상 맨 앞)
            if ($popup.is(':visible') && $popup.attr('tabindex') != null && String($popup.attr('tabindex')) !== '-1') {
                $focusable = $popup.add($focusable);
            }

            // 현재 포커스가 팝업 안인데 목록에 없으면 문서 순서로 삽입
            var active = document.activeElement;
            if (active && popupEl.contains(active) && $focusable.index(active) === -1
                && !$(active).is('.mo-gnb-focus-loop')) {
                var list = $focusable.get();
                list.push(active);
                list.sort(function (a, b) {
                    var pos = a.compareDocumentPosition(b);
                    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
                    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
                    return 0;
                });
                $focusable = $(list);
            }

            if (!$focusable.length) return;

            var first = $focusable.get(0);
            var last = $focusable.get($focusable.length - 1);

            // 포커스가 팝업 밖으로 나간 경우 안으로 되돌림
            if (active !== popupEl && (!active || !popupEl.contains(active))) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
                return;
            }

            if (e.shiftKey) {
                if (active === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (active === last) {
                e.preventDefault();
                first.focus();
            }
        });
    }

    function unbindLayerFocusTrap() {
        $('.popup').off('keydown' + FOCUS_TRAP_NS);
    }

    function setA11y() {
        $(".btnPopOpen").each(function(){
            var $btn = $(this);
            $btn.attr('role', 'button')
            $btn.attr('aria-haspopup', 'dialog');
            $btn.attr('aria-expanded', 'false');
        });

        $('[target="_blank"]').each(function(){
            var $link = $(this);
            // $link.attr('rel', 'noopener noreferrer');
            $link.attr('title', '새 창 열림');
        });
    }

    function setPopupA11y($popup, isOpen) {
        if (isOpen) {
            $popup.attr({ role: 'dialog', 'aria-modal': 'true' });
            if (!$popup.attr('aria-label') && !$popup.attr('aria-labelledby')) {
                var $title = $popup.find('.pop-head .tit, .popup-header .tit, h2, h3').first();
                if ($title.length) {
                    var titleId = $popup.attr('id') ? $popup.attr('id') + '-title' : 'popup-title-' + Date.now();
                    $title.attr('id', titleId);
                    $popup.attr('aria-labelledby', titleId);
                }
            }
        } else {
            $popup.removeAttr('role aria-modal aria-labelledby');
        }
    }

    // --- toast 3초 자동 닫힘 ---

    /** 토스트 팝업 3초 후 자동으로 닫힘 (이전 타이머 있으면 재시작) */
    function toastNone() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        timer = setTimeout(function () {
            timer = null;
            $('.sort-block + .popup.toast, .toastPop, .popup.toast').stop().fadeOut(500, function () {
                $(this).removeClass('on over');
            });
        }, 3000);
    }

    /**
     * 팝업 document 위임 초기화 (PopupManager.init)
     * - setA11y / z-index 는 매번 가능, 이벤트는 popupEventsBound 으로 1회
     */
    function popup() {
        var winWidth = $(window).width();
        var winHeight = $(window).height();
        var pc = 768;

        setA11y();
        updatePopupZIndex();

        // document 위임은 페이지당 1회만 (중복 바인딩 누수 방지)
        if (popupEventsBound) return;
        popupEventsBound = true;

        function popOn(e) {
            e.preventDefault();

            var href = normalizePopupKey($(this).attr('href') || $(this).attr('data-href'));
            if (!href || $(href).length < 1) return;

            $popBtnInx = $(this);
            $popBtnInx.attr('aria-expanded', 'true');

            var $popup = $(href);
            $popup.stop(true, true).addClass('on').attr('tabindex', '0');

            if ($popup.css('display') === 'none') {
                $popup.css('display', 'flex').hide().fadeIn(200, function () {
                    syncPopupLayers();
                });
            } else {
                $popup.css('display', 'flex');
            }

            if (!$popup.hasClass('toast')) {
                $popup.focus();
                $('html, body').css({'overflow' : 'hidden', 'height' : 'auto'});
            }

            if ($(this).parents('div').is('.popup')) {
                $(this).parents('.popup').attr('data-open-popup-id', href);
            }

            var $popCont = $popup.find('.pop-cont, .popup-container');
            if ($popCont.length && $popCont.height() < $popCont[0].scrollHeight) {
                // $popCont.attr('tabindex', '0');
            }

            setPopupA11y($popup, true);
            bindLayerFocusTrap($popup);

            if ($popup.hasClass('toast')) {
                toastNone();
            }

            var popHeight = $popup.find('.pop-wrap').outerHeight();
            var popHeaderHeight = $popup.find('.pop-head').outerHeight();
            var winPadding = (winWidth >= pc) ? (parseInt($('.header').height(), 10) * 2) : 0;

            if (winHeight <= popHeight + winPadding) {
                $popup.addClass('over').find('.pop-cont, .popup-container').outerHeight(winHeight - popHeaderHeight - winPadding);
            }

            onPopArr.push(href);

            if (!$popup.hasClass('toast') && !$popup.hasClass('main-banner')) {
                openPopupDim();
            } else {
                syncPopupLayers();
            }

            if (!$popup.hasClass('toast') && window.self !== window.top && window.parent) {
                window.parent.postMessage({ dim: 'Y' }, '*');
            }
        }

        function popOff(event) {
            var popId = $(this).parents('.popup').attr('id');
            var popKey = '#' + popId;
            var $popup = $(this).closest('.popup');

            $(this).attr('aria-expanded', 'false');

            if ($popup.hasClass('toast') && timer) {
                clearTimeout(timer);
                timer = null;
            }

            $popup.stop().fadeOut(100, function () {
                $popup.removeClass('on over');
            });
            $popup.find('.pop-cont').removeAttr('style');
            $popup.removeAttr('data-open-popup-id').removeAttr('tabindex');
            setPopupA11y($popup, false);
            unbindLayerFocusTrap();

            onPopArr = onPopArr.filter(function (element) {
                return element !== popKey;
            });

            if (onPopArr.length < 1) {
                $('html, body').css({ overflow: '', height: '' });
                $('body > .dim').remove();
            } else {
                trimPopupDimStack(getLayerPopupCount());
                syncPopupLayers();
                bindLayerFocusTrap($(onPopArr[onPopArr.length - 1]));
            }

            if (window.self !== window.top && window.parent) {
                window.parent.postMessage({
                    height: $('#content').outerHeight(),
                    dim: 'N'
                }, '*');
            }

            onPopObj[popKey] && onPopObj[popKey].onClose && onPopObj[popKey].onClose();
            delete onPopObj[popKey];

            // btnPopOpen 경로: 연 버튼으로 포커스 복원
            if ($popBtnInx) {
                if ($popBtnInx.is(':visible') === false) {
                    $popBtnInx.prev().focus();
                } else {
                    $popBtnInx.focus();
                }
                $popBtnInx.attr('aria-expanded', 'false');
            }
            // Base.Ui.showPopup 경로: options.onClose(위)에서 오프너 포커스 복원.
            // skipToContent/logo 폴백은 그 포커스를 덮어쓰므로 사용하지 않음.
            // else if (event.originalEvent) {
            //     if (!event.originalEvent.pointerType) {
            //         if (window.innerWidth > 767) {
            //             $('#skipToContent').focus();
            //         } else {
            //             $('.header-wrap .logo > a').focus();
            //         }
            //     }
            // } else {
            //     if (window.innerWidth > 767) {
            //         $('#skipToContent').focus();
            //     } else {
            //         $('.header-wrap .logo > a').focus();
            //     }
            // }

            if (onPopArr.length < 1) $popBtnInx = null;
        }

        function escClose(e) {
            if (e.key !== 'Escape' && e.keyCode !== 27) return;

            var targetId = null;
            $('.popup').each(function (idx, ele) {
                var $ele = $(ele);
                if ($ele.hasClass('on') || $ele.css('display') === 'block' || $ele.css('display') === 'flex') {
                    targetId = $ele.attr('id');
                }
            });
            if (!targetId || $('#' + targetId).data('esc')) return;
            triggerPopupCloseBtn($('#' + targetId));
        }

        function popAllOff() {
            var closePopId = $(this).attr('data-close-popup-id');
            $(this).parents('.popup').find('.btnPopClose').trigger('click');
            $(closePopId).find('.btnPopClose').trigger('click');
        }

        /**
         * 닫기 트리거 버튼 선택
         * - .btn-close(X) 우선: 확인(.btn-pop-close)보다 앞설 수 있고 disabled일 수 있음
         * - 없으면 활성 btnPopClose / btnPopCancel
         */
        function getPopupCloseBtn($popup) {
            // X 버튼(.btn-close) 우선 — btnPopClose 유무와 무관
            var $btn = $popup.find('.btn-close').first();
            if ($btn.length) return $btn;

            $btn = $popup.find('.btnPopClose:not(.closeToday):not(:disabled), .btnPopCancel:not(:disabled)').first();
            if ($btn.length) return $btn;

            return $popup.find('.btnPopClose:not(.closeToday), .btnPopCancel').first();
        }

        function triggerPopupCloseBtn($popup) {
            var $btn = getPopupCloseBtn($popup);
            if ($btn.length) $btn.trigger('click');
        }

        /** .pop-wrap / .popup-wrap 바깥(오버레이) 클릭 시 닫기 */
        function popBackdropClose(e) {
            var $popup = $(this);

            if (!$popup.hasClass('on') && $popup.css('display') === 'none') return;
            if ($popup.hasClass('toast') || $popup.hasClass('alert')) return;
            if ($(e.target).closest('.pop-wrap, .popup-wrap').length) return;

            triggerPopupCloseBtn($popup);
        }

        /**
         * MO .popup.bottom-sheet — popup-header를 아래로 드래그하면 닫기
         * (열기는 btnPopOpen 등 기존 이벤트 유지)
         */
        var bottomSheetDrag = {
            active: false,
            pointerId: null,
            startY: 0,
            lastY: 0,
            lastTime: 0,
            $popup: null,
            $wrap: null
        };

        var BOTTOM_SHEET_DRAG_CLOSE_PX = 80;
        var BOTTOM_SHEET_FLING_PX_PER_MS = 0.35;
        var BOTTOM_SHEET_DRAG_NS = '.bottomSheetDragClose';
        var ghostClickGuardHandler = null;
        var ghostClickGuardTimer = null;

        function suppressGhostClick(durationMs) {
            if (ghostClickGuardHandler) {
                document.removeEventListener('click', ghostClickGuardHandler, true);
                window.clearTimeout(ghostClickGuardTimer);
            }

            ghostClickGuardHandler = function (e) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
            };

            document.addEventListener('click', ghostClickGuardHandler, true);
            ghostClickGuardTimer = window.setTimeout(function () {
                document.removeEventListener('click', ghostClickGuardHandler, true);
                ghostClickGuardHandler = null;
                ghostClickGuardTimer = null;
            }, durationMs || 400);
        }

        function resetBottomSheetDragTransform($wrap, animate) {
            if (!$wrap || !$wrap.length) return;
            if (animate) {
                $wrap.css({
                    transition: 'transform 0.25s ease',
                    transform: '',
                    willChange: ''
                });
                window.setTimeout(function () {
                    $wrap.css({ transition: '', transform: '', willChange: '' });
                }, 260);
            } else {
                $wrap.css({ transition: '', transform: '', willChange: '' });
            }
        }

        function closeBottomSheetByDrag($popup, $wrap) {
            // 드래그 종료 후 합성 click이 아래 btnPopOpen을 다시 누르는 것 방지
            suppressGhostClick(450);

            if ($wrap && $wrap.length) {
                $wrap.css({
                    transition: 'transform 0.2s ease',
                    transform: 'translateY(100%)'
                });
            }
            window.setTimeout(function () {
                triggerPopupCloseBtn($popup);
                resetBottomSheetDragTransform($wrap, false);
            }, 180);
        }

        function onBottomSheetHeaderPointerDown(e) {
            if (window.innerWidth > 767) return;
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            if ($(e.target).closest('button, a, input, select, textarea, label, .btn-close, .btnPopClose, .btnPopCancel').length) return;

            var $header = $(this);
            var $popup = $header.closest('.popup.bottom-sheet');
            if (!$popup.length || !$popup.hasClass('on')) return;

            var $wrap = $popup.children('.pop-wrap').first();
            if (!$wrap.length) $wrap = $popup.find('.pop-wrap').first();
            if (!$wrap.length) return;

            bottomSheetDrag.active = true;
            bottomSheetDrag.pointerId = e.pointerId;
            bottomSheetDrag.startY = e.clientY;
            bottomSheetDrag.lastY = e.clientY;
            bottomSheetDrag.lastTime = (window.performance && performance.now) ? performance.now() : Date.now();
            bottomSheetDrag.$popup = $popup;
            bottomSheetDrag.$wrap = $wrap;

            try { this.setPointerCapture(e.pointerId); } catch (err) {}

            $wrap.css({
                transition: 'none',
                willChange: 'transform'
            });

            $(document)
                .on('pointermove' + BOTTOM_SHEET_DRAG_NS, onBottomSheetHeaderPointerMove)
                .on('pointerup' + BOTTOM_SHEET_DRAG_NS + ' pointercancel' + BOTTOM_SHEET_DRAG_NS, onBottomSheetHeaderPointerUp);
        }

        function onBottomSheetHeaderPointerMove(e) {
            if (!bottomSheetDrag.active || e.pointerId !== bottomSheetDrag.pointerId) return;
            if (e.cancelable) e.preventDefault();

            var now = (window.performance && performance.now) ? performance.now() : Date.now();
            var deltaY = Math.max(0, e.clientY - bottomSheetDrag.startY);

            bottomSheetDrag.lastY = e.clientY;
            bottomSheetDrag.lastTime = now;
            bottomSheetDrag.$wrap.css('transform', 'translateY(' + deltaY + 'px)');
        }

        function onBottomSheetHeaderPointerUp(e) {
            if (!bottomSheetDrag.active || e.pointerId !== bottomSheetDrag.pointerId) return;

            var $popup = bottomSheetDrag.$popup;
            var $wrap = bottomSheetDrag.$wrap;
            var startY = bottomSheetDrag.startY;
            var lastY = bottomSheetDrag.lastY;
            var lastTime = bottomSheetDrag.lastTime;

            bottomSheetDrag.active = false;
            bottomSheetDrag.pointerId = null;
            bottomSheetDrag.$popup = null;
            bottomSheetDrag.$wrap = null;

            $(document).off(BOTTOM_SHEET_DRAG_NS);

            var deltaY = Math.max(0, e.clientY - startY);
            var now = (window.performance && performance.now) ? performance.now() : Date.now();
            var dt = Math.max(1, now - lastTime);
            var vy = (e.clientY - lastY) / dt;
            var shouldClose = deltaY >= BOTTOM_SHEET_DRAG_CLOSE_PX || vy > BOTTOM_SHEET_FLING_PX_PER_MS;

            if (shouldClose) {
                closeBottomSheetByDrag($popup, $wrap);
            } else {
                resetBottomSheetDragTransform($wrap, true);
            }
        }

        $(document)
            .on('click', '.btnPopOpen', popOn)
            .on('click', '.btnPopClose, .btnPopCancel', function (event) {
                popOff.call(this, event);
            })
            // .btn-close 만 있는 경우: .pop-wrap → 레이어 닫기 / .popup-wrap 직속 → 창 닫기
            .on('click', '.pop-wrap .btn-close', function (event) {
                if ($(this).is('.btnPopClose, .btnPopCancel')) return;
                popOff.call(this, event);
            })
            .on('click', '.popup-wrap > .btn-close', function () {
                if ($(this).is('.btnPopClose, .btnPopCancel')) return;
                closePopupWindow();
            })
            .on('click', '.popup.on', popBackdropClose)
            .on('pointerdown', '.popup.bottom-sheet.on .popup-header, .popup.bottom-sheet.on .pop-head', onBottomSheetHeaderPointerDown)
            .on('keydown', escClose)
            .on('click', '.btnPopConnectClose', popAllOff);
    }

    /**
     * 프로그래밍 팝업 닫기
     * - btnPopClose 클릭 → popOff → onPopObj.onClose (이중 호출 방지)
     * - eventDetail 등에서 popDisplayClose 재호출 시 루프 주의
     */
    window.popDisplayClose = function (targetPop, options) {
        if (!targetPop) return;

        var $target = typeof targetPop === 'string' ? $(targetPop) : $(targetPop);
        if (!$target.length && targetPop && targetPop.nodeType === 1) {
            $target = $(targetPop);
        }

        var popId = $target.attr('id');
        var popKey = popId ? '#' + popId : normalizePopupKey(targetPop);

        // trigger → popOff가 onPopObj.onClose를 실행하므로, 없을 때만 options.onClose를 붙임 (이중 호출 방지)
        if (options && typeof options === 'object' && typeof options.onClose === 'function') {
            if (onPopObj[popKey] && !onPopObj[popKey].onClose) {
                onPopObj[popKey].onClose = options.onClose;
            }
        }

        if ($target.length) {
            var $closeBtn = $target.find('.btnPopClose, .btnPopCancel').first();
            if ($closeBtn.length) {
                $closeBtn.trigger('click');
                return;
            }
        }

        if (options && typeof options === 'object' && typeof options.onClose === 'function') {
            options.onClose();
        }
    };

    function keyboard(pop){
        const uA = navigator.userAgent.toLowerCase();
        // 1. 조건 체크: 카카오톡(kakaotalk)이면서 안드로이드(android)인 경우에만 실행
        const isKakaoTalk = uA.includes('kakaotalk');
        const isAndroid = uA.includes('android');

        if (!isKakaoTalk || !isAndroid) return;

        // 2. 전달받은 팝업 아이디/클래스 내부의 input 요소들만 선택
        const popupElement = document.querySelector(pop);
        if (!popupElement) return; // 팝업 요소를 찾지 못하면 종료

        const inputs = popupElement.querySelectorAll('input, textarea');

        // 스크롤 공통 실행 함수
        function handleScroll(event) {
            // 안드로이드 카카오톡 웹뷰는 키보드가 뷰포트를 가리는 속도가 제각각이므로 
            // 최소 300~400ms의 지연(Timeout)을 주어야 안정적으로 스크롤이 맞춰집니다.
            setTimeout(() => {
                event.target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center' // 키보드 바로 위 중앙에 위치하도록 배치
                });

                popupElement.style.paddingBottom = "200px";
            }, 350);
        }

        // 3. 각 인풋들에 이벤트 바인딩
        inputs.forEach(input => {
            // 최초 포커스 시점 스크롤 처리
            input.addEventListener('focus', handleScroll);

            // 키보드 내리기 버튼으로 키보드만 닫힌 상태(포커스 유지)에서 다시 클릭했을 때 처리
            input.addEventListener('click', (event) => {
                // 현재 클릭한 인풋이 활성화(activeElement) 상태인데 또 클릭된 경우에만 실행
                if (document.activeElement === event.target) {
                    handleScroll(event);
                }
            });
        });
    }
    /**
     * 프로그래밍 팝업 오픈 (Base.Ui.showPopup / bestshop 직접 호출)
     * @param {string|HTMLElement} targetPop - '#id' 또는 요소
     * @param {Object|string} [options] - {onShow,onClose} 또는 포커스 복원 셀렉터 문자열
     */
    window.popDisplayBlock = function (targetPop, options) {
        var popKey = normalizePopupKey(targetPop);
        var $pop = $(popKey);
        options = options || {};

        if (typeof options === 'string') {
            $popBtnInx = $(options);
            options = {};
        }

        if (!$pop.length) return;

        $pop.stop(true, true).addClass('on').css('display', 'flex');

        if (!$pop.hasClass('toast') && !$pop.hasClass('main-banner')) {
            $('html, body').css({'overflow' : 'hidden', 'height' : 'auto'});
        }

        onPopArr.push(popKey);
        onPopObj[popKey] = options;



        if (!$pop.hasClass('toast') && !$pop.hasClass('main-banner')) {
            openPopupDim();
        } else {
            syncPopupLayers();
        }

        setPopupA11y($pop, true);
        bindLayerFocusTrap($pop);
        keyboard(popKey);

        if (!$pop.hasClass('toast')) {
            $pop.css('outline', 'none').attr('tabindex', '0').focus();
        }

        if (options && typeof options === 'object' && typeof options.onShow === 'function') {
            options.onShow();
        }
    };

    /**
     * @namespace PopupManager
     * 레이어 팝업 공개 API (dim 스택 · 포커스 트랩 · 프로그래밍 열기/닫기)
     * - init → document 위임(btnPopOpen/Close) 1회 바인딩
     * - bindFocusTrap: customerInspiring 등에서 동적 콘텐츠 후 재바인딩
     */
    var PopupManager = {
        init: popup,
        updateZIndex: updatePopupZIndex,
        syncLayers: syncPopupLayers,
        openDim: openPopupDim,
        normalizeKey: normalizePopupKey,
        toastHide: toastNone,
        bindFocusTrap: bindLayerFocusTrap,
        unbindFocusTrap: unbindLayerFocusTrap,
        setA11y: setPopupA11y
    };

    // =========================================================================
    // ImageMapManager — 반응형 이미지 맵 (vanilla JS)
    // - 원본 coords는 area[data-rwd-coords]에 보관
    // - 표시 크기 / natural 크기 비율로 coords 재계산
    // - ResizeObserver + 이미지 load 시 갱신 (동적 DOM 포함)
    // - 제거된 img 는 fallback 배열·observer.disconnect 로 정리
    // =========================================================================

    var responsiveImageMapBindings = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var responsiveImageMapFallbackSet = [];
    var responsiveImageMapFallbackBound = false;

    function getImageMapElement(img) {
        var usemap = img.getAttribute('usemap');
        if (!usemap) return null;

        var mapId = usemap.replace(/^#/, '').trim();
        if (!mapId) return null;

        return document.querySelector('map[name="' + mapId.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"]')
            || document.getElementById(mapId);
    }

    function parseCoordValues(coordsStr) {
        return String(coordsStr).trim().split(/[\s,]+/).filter(Boolean).map(function (v) {
            return parseFloat(v, 10);
        });
    }

    function cacheOriginalCoords(areas) {
        Array.prototype.forEach.call(areas, function (area) {
            if (!area.dataset.rwdCoords) {
                area.dataset.rwdCoords = area.getAttribute('coords') || '';
            }
        });
    }

    function scaleCoordString(originalCoords, scaleX, scaleY) {
        var values = parseCoordValues(originalCoords);
        var scaled = values.map(function (value, index) {
            var ratio = index % 2 === 0 ? scaleX : scaleY;
            return Math.round(value * ratio);
        });
        return scaled.join(',');
    }

    function getDisplaySize(img) {
        var rect = img.getBoundingClientRect();
        var width = rect.width || img.clientWidth || img.width;
        var height = rect.height || img.clientHeight || img.height;
        return { width: width, height: height };
    }

    function adjustResponsiveImageMap(img) {
        var mapEl = getImageMapElement(img);
        if (!mapEl) return;

        var areas = mapEl.querySelectorAll('area');
        if (!areas.length) return;

        var naturalWidth = img.naturalWidth;
        var naturalHeight = img.naturalHeight;
        if (!naturalWidth || !naturalHeight) return;

        var display = getDisplaySize(img);
        if (!display.width || !display.height) return;

        var scaleX = display.width / naturalWidth;
        var scaleY = display.height / naturalHeight;

        cacheOriginalCoords(areas);

        Array.prototype.forEach.call(areas, function (area) {
            var original = area.dataset.rwdCoords;
            if (!original) return;
            area.setAttribute('coords', scaleCoordString(original, scaleX, scaleY));
        });
    }

    function runResponsiveImageMapAdjust(img) {
        if (img.complete && img.naturalWidth > 0) {
            adjustResponsiveImageMap(img);
            return;
        }

        img.addEventListener('load', function onImgLoad() {
            adjustResponsiveImageMap(img);
        }, { once: true });
    }

    function scheduleResponsiveImageMapFallback() {
        // 제거된 이미지는 fallback 목록에서 정리 (참조 누수 방지)
        responsiveImageMapFallbackSet = responsiveImageMapFallbackSet.filter(function (img) {
            return img && img.isConnected;
        });
        if (!responsiveImageMapFallbackSet.length) return;

        window.requestAnimationFrame(function () {
            responsiveImageMapFallbackSet.forEach(function (img) {
                if (img.isConnected) adjustResponsiveImageMap(img);
            });
        });
    }

    function bindResponsiveImageMap(img) {
        if (img.dataset.rwdImagemapBound === 'true') return;
        img.dataset.rwdImagemapBound = 'true';

        runResponsiveImageMapAdjust(img);

        if (typeof ResizeObserver !== 'undefined') {
            var observer = new ResizeObserver(function () {
                if (!img.isConnected) {
                    observer.disconnect();
                    if (responsiveImageMapBindings) responsiveImageMapBindings.delete(img);
                    return;
                }
                adjustResponsiveImageMap(img);
            });
            observer.observe(img);

            if (responsiveImageMapBindings) {
                responsiveImageMapBindings.set(img, { observer: observer });
            }
            return;
        }

        if (responsiveImageMapFallbackSet.indexOf(img) === -1) {
            responsiveImageMapFallbackSet.push(img);
        }

        if (!responsiveImageMapFallbackBound) {
            responsiveImageMapFallbackBound = true;
            window.addEventListener('resize', scheduleResponsiveImageMapFallback, { passive: true });
            window.addEventListener('orientationchange', scheduleResponsiveImageMapFallback, { passive: true });
        }
    }

    function bindResponsiveImageMaps($scope) {
        getRoot($scope).find('img[usemap]').each(function () {
            bindResponsiveImageMap(this);
        });
    }

    /** display 전환 등 resize가 없을 때 coords 재계산 */
    function refreshResponsiveImageMaps($scope) {
        getRoot($scope).find('img[usemap][data-rwd-imagemap-bound]').each(function () {
            adjustResponsiveImageMap(this);
        });
    }

    /**
     * @namespace ImageMapManager
     * 반응형 이미지맵 공개 API
     */
    var ImageMapManager = {
        init: initImgMaps,
        bind: bindResponsiveImageMaps,
        refresh: refreshResponsiveImageMaps,
        adjust: adjustResponsiveImageMap
    };

    // =========================================================================
    // NaverMapA11y — 네이버 지도 줌 컨트롤 · InfoWindow 포커스 접근성
    // - setMapZoomA11y / focusMapInfoWindow 등은 window에도 노출 (bestshop 호출)
    // =========================================================================

    var mapInfoWindowLastFocus = null;
    var mapInfoWindowActiveOverlay = null;
    var mapInfoWindowFocusTimer = null;
    var MAP_INFOWINDOW_FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    var MAP_INFOWINDOW_TRAP_NS = 'mapInfoWindowFocusTrap';

    function unbindMapInfoWindowFocusTrap() {
        if (mapInfoWindowFocusTimer) {
            window.clearTimeout(mapInfoWindowFocusTimer);
            mapInfoWindowFocusTimer = null;
        }
        if (mapInfoWindowActiveOverlay && mapInfoWindowActiveOverlay._mapIwKeydown) {
            mapInfoWindowActiveOverlay.removeEventListener('keydown', mapInfoWindowActiveOverlay._mapIwKeydown);
            mapInfoWindowActiveOverlay._mapIwKeydown = null;
        }
        if (document._mapIwFocusIn) {
            document.removeEventListener('focusin', document._mapIwFocusIn, true);
            document._mapIwFocusIn = null;
        }
        if (document._mapIwEsc) {
            document.removeEventListener('keydown', document._mapIwEsc, true);
            document._mapIwEsc = null;
        }
        mapInfoWindowActiveOverlay = null;
    }

    function bindMapInfoWindowFocusTrap(overlay, options) {
        if (!overlay) return;
        options = options || {};

        unbindMapInfoWindowFocusTrap();
        mapInfoWindowActiveOverlay = overlay;

        var onKeyDown = function (e) {
            if (e.key !== 'Tab') return;

            var focusables = getMapInfoWindowFocusable(overlay);
            if (!focusables.length) {
                e.preventDefault();
                overlay.focus();
                return;
            }

            var first = focusables[0];
            var last = focusables[focusables.length - 1];

            if (e.shiftKey) {
                if (document.activeElement === first || !overlay.contains(document.activeElement)) {
                    e.preventDefault();
                    last.focus();
                }
            } else if (document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };

        var onFocusIn = function (e) {
            if (!mapInfoWindowActiveOverlay) return;
            if (mapInfoWindowActiveOverlay.contains(e.target)) return;

            var focusables = getMapInfoWindowFocusable(mapInfoWindowActiveOverlay);
            if (focusables.length) {
                focusables[0].focus();
            } else {
                mapInfoWindowActiveOverlay.focus();
            }
        };

        var onEscape = function (e) {
            if (e.key !== 'Escape' && e.keyCode !== 27) return;
            if (!mapInfoWindowActiveOverlay) return;

            e.preventDefault();
            e.stopPropagation();

            if (typeof options.onEscape === 'function') {
                options.onEscape();
                return;
            }

            var closeBtn = mapInfoWindowActiveOverlay.querySelector('.btn-overlay-close');
            if (closeBtn) {
                closeBtn.click();
            }
        };

        overlay._mapIwKeydown = onKeyDown;
        document._mapIwFocusIn = onFocusIn;
        document._mapIwEsc = onEscape;

        overlay.addEventListener('keydown', onKeyDown);
        document.addEventListener('focusin', onFocusIn, true);
        document.addEventListener('keydown', onEscape, true);
    }

    /**
     * 지도 마커(커스텀 HTML) 키보드 접근성
     * @param {HTMLElement|string} markerEl
     * @param {Function} [onActivate] - Enter/Space 시 실행 (미지정 시 click)
     * @param {Object} [options]
     * @param {string} [options.label] - aria-label
     */
    function bindMapMarkerKeyboard(markerEl, onActivate, options) {
        if (typeof markerEl === 'string') {
            markerEl = document.querySelector(markerEl);
        }
        if (!markerEl || markerEl.nodeType !== 1) return;

        options = options || {};

        if (!markerEl.getAttribute('role')) {
            markerEl.setAttribute('role', 'button');
        }
        if (!markerEl.hasAttribute('tabindex')) {
            markerEl.setAttribute('tabindex', '0');
        }
        if (options.label) {
            markerEl.setAttribute('aria-label', options.label);
        } else if (!markerEl.getAttribute('aria-label')) {
            var text = (markerEl.textContent || '').replace(/\s+/g, ' ').trim();
            if (text) {
                markerEl.setAttribute('aria-label', text + ' 매장 정보 보기');
            }
        }

        if (markerEl._mapMarkerKeyHandler) {
            markerEl.removeEventListener('keydown', markerEl._mapMarkerKeyHandler);
        }

        markerEl._mapMarkerKeyHandler = function (e) {
            if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
            e.preventDefault();
            e.stopPropagation();

            if (typeof onActivate === 'function') {
                onActivate(e);
            } else if (typeof markerEl.click === 'function') {
                markerEl.click();
            }
        };

        markerEl.addEventListener('keydown', markerEl._mapMarkerKeyHandler);
    }

    /**
     * 네이버 지도 줌인/줌아웃 버튼 접근성
     * - 컨트롤 DOM이 늦게 그려지므로 재시도/idle 대기
     * - 이미지 경로(zoom-in-small 등) 변경에도 대응
     * @param {string} target - 지도 컨테이너 선택자 (예: '#ShopListMap')
     * @param {naver.maps.Map} map - 네이버 맵 인스턴스
     * @param {boolean} [flag=false] - (호환용) 사용하지 않음. 키보드 줌은 항상 활성
     */
    function setMapZoomA11y(target, map, flag) {
        if (!target || !map) return;

        var root = typeof target === 'string' ? document.querySelector(target) : target;
        if (!root) return;

        var MAX_RETRY = 20;
        var RETRY_DELAY = 100;
        var retryCount = 0;
        var idleListener = null;
        var retryTimer = null;

        var isZoomInSrc = function (src) {
            src = String(src || '').toLowerCase();
            return src.indexOf('zoom-in') !== -1 || src.indexOf('zoomin') !== -1 || src.indexOf('btn_plus') !== -1;
        };
        var isZoomOutSrc = function (src) {
            src = String(src || '').toLowerCase();
            return src.indexOf('zoom-out') !== -1 || src.indexOf('zoomout') !== -1 || src.indexOf('btn_minus') !== -1;
        };

        var findZoomButtons = function () {
            var zoomInButton = null;
            var zoomOutButton = null;
            var images = root.querySelectorAll('img');
            var i;
            var img;
            var src;

            for (i = 0; i < images.length; i += 1) {
                img = images[i];
                src = img.currentSrc || img.src || img.getAttribute('src') || '';
                if (!zoomInButton && isZoomInSrc(src)) {
                    zoomInButton = img.parentElement;
                }
                if (!zoomOutButton && isZoomOutSrc(src)) {
                    zoomOutButton = img.parentElement;
                }
            }

            // 이미지 경로가 바뀐 경우: 줌 컨트롤 컨테이너의 상/하 버튼으로 추정
            if (!zoomInButton || !zoomOutButton) {
                var controlCandidates = root.querySelectorAll(
                    '[class*="zoom"], [class*="Zoom"], .imap-control, .control-group'
                );
                for (i = 0; i < controlCandidates.length; i += 1) {
                    var buttons = controlCandidates[i].querySelectorAll('button, a, [role="button"], div[tabindex], span[tabindex]');
                    if (buttons.length >= 2) {
                        if (!zoomInButton) zoomInButton = buttons[0];
                        if (!zoomOutButton) zoomOutButton = buttons[1];
                        break;
                    }
                }
            }

            // title/aria-label 기반
            if (!zoomInButton || !zoomOutButton) {
                var allClickable = root.querySelectorAll('button, a, [role="button"]');
                for (i = 0; i < allClickable.length; i += 1) {
                    var el = allClickable[i];
                    var label = (
                        (el.getAttribute('title') || '') + ' ' +
                        (el.getAttribute('aria-label') || '') + ' ' +
                        (el.textContent || '')
                    ).toLowerCase();
                    if (!zoomInButton && (label.indexOf('확대') !== -1 || label.indexOf('zoom in') !== -1 || label.indexOf('+') !== -1)) {
                        zoomInButton = el;
                    }
                    if (!zoomOutButton && (label.indexOf('축소') !== -1 || label.indexOf('zoom out') !== -1 || label.indexOf('-') !== -1)) {
                        zoomOutButton = el;
                    }
                }
            }

            return { zoomInButton: zoomInButton, zoomOutButton: zoomOutButton };
        };

        var bindZoomButton = function (button, type, counterpart) {
            if (!button || button.getAttribute('data-map-zoom-a11y') === type) return;

            var img = button.querySelector && button.querySelector('img');
            if (img) img.alt = '';

            button.setAttribute('title', type === 'in' ? '지도 확대' : '지도 축소');
            button.setAttribute('role', 'button');
            if (!button.hasAttribute('tabindex')) button.setAttribute('tabindex', '0');
            button.setAttribute('data-map-zoom-a11y', type);

            var onKeyDown = function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                if (type === 'in') {
                    map.setZoom(map.getZoom() + 1, true);
                } else {
                    map.setZoom(map.getZoom() - 1, true);
                }
            };

            // 이전 핸들러 제거 후 재바인딩
            if (button._mapZoomKeyHandler) {
                button.removeEventListener('keydown', button._mapZoomKeyHandler);
            }
            button._mapZoomKeyHandler = onKeyDown;
            button.addEventListener('keydown', onKeyDown);

            if (button._mapZoomClickHandler) {
                button.removeEventListener('click', button._mapZoomClickHandler);
            }
            button._mapZoomClickHandler = function () {
                if (counterpart && document.activeElement === counterpart) {
                    counterpart.blur();
                }
            };
            button.addEventListener('click', button._mapZoomClickHandler);
        };

        var apply = function () {
            var found = findZoomButtons();
            if (!found.zoomInButton && !found.zoomOutButton) {
                return false;
            }

            bindZoomButton(found.zoomInButton, 'in', found.zoomOutButton);
            bindZoomButton(found.zoomOutButton, 'out', found.zoomInButton);
            return !!(found.zoomInButton && found.zoomOutButton);
        };

        var cleanupRetry = function () {
            if (retryTimer) {
                clearTimeout(retryTimer);
                retryTimer = null;
            }
            if (idleListener && typeof naver !== 'undefined' && naver.maps && naver.maps.Event) {
                naver.maps.Event.removeListener(idleListener);
                idleListener = null;
            }
        };

        var tryApply = function () {
            if (apply()) {
                cleanupRetry();
                return;
            }

            retryCount += 1;
            if (retryCount >= MAX_RETRY) {
                cleanupRetry();
                return;
            }

            retryTimer = setTimeout(tryApply, RETRY_DELAY);
        };

        // 이미 있으면 즉시, 없으면 재시도 + map idle 한 번 더
        if (!apply()) {
            if (typeof naver !== 'undefined' && naver.maps && naver.maps.Event) {
                idleListener = naver.maps.Event.addListener(map, 'idle', function () {
                    tryApply();
                });
            }
            tryApply();
        }
    }

    function resolveMapRoot(mapOrSelector) {
        if (!mapOrSelector) return document;

        if (typeof mapOrSelector === 'string') {
            return document.querySelector(mapOrSelector) || document;
        }

        if (mapOrSelector.getElement && typeof mapOrSelector.getElement === 'function') {
            return mapOrSelector.getElement() || document;
        }

        if (mapOrSelector.nodeType === 1) {
            return mapOrSelector;
        }

        return document;
    }

    function resolveMapInfoWindowOverlay(options) {
        options = options || {};

        if (options.overlay && options.overlay.nodeType === 1) {
            return options.overlay;
        }

        var selector = options.overlaySelector || '.overlay';
        var root = resolveMapRoot(options.map || options.target);
        var overlays = root.querySelectorAll(selector);

        if (!overlays.length && root !== document) {
            overlays = document.querySelectorAll(selector);
        }

        if (!overlays.length) return null;

        // 가장 최근(마지막) 노출 오버레이 우선
        for (var i = overlays.length - 1; i >= 0; i -= 1) {
            var el = overlays[i];
            if (el.offsetWidth > 0 || el.offsetHeight > 0) {
                return el;
            }
        }

        return overlays[overlays.length - 1];
    }

    function getMapInfoWindowFocusable(overlay) {
        if (!overlay) return [];
        return Array.prototype.filter.call(overlay.querySelectorAll(MAP_INFOWINDOW_FOCUSABLE), function (el) {
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        });
    }

    /**
     * InfoWindow(.overlay) 열림 시 포커스 이동 + 포커스 트랩
     * @param {Object} [options]
     * @param {string|HTMLElement|naver.maps.Map} [options.map] - 지도 또는 컨테이너
     * @param {string|HTMLElement|naver.maps.Map} [options.target] - map 별칭
     * @param {HTMLElement} [options.overlay] - 오버레이 요소 직접 지정
     * @param {string} [options.overlaySelector='.overlay']
     * @param {string} [options.focusSelector] - 우선 포커스 대상 (기본: 닫기 버튼)
     * @param {HTMLElement|string} [options.returnFocus] - 닫힐 때 복귀할 요소
     * @param {Function} [options.onEscape] - Esc 닫기 콜백
     */
    function focusMapInfoWindow(options) {
        options = options || {};

        var returnFocus = options.returnFocus;
        if (typeof returnFocus === 'string') {
            returnFocus = document.querySelector(returnFocus);
        }
        if (!returnFocus || typeof returnFocus.focus !== 'function') {
            returnFocus = document.activeElement;
        }
        mapInfoWindowLastFocus = returnFocus;

        if (mapInfoWindowFocusTimer) {
            window.clearTimeout(mapInfoWindowFocusTimer);
            mapInfoWindowFocusTimer = null;
        }

        mapInfoWindowFocusTimer = window.setTimeout(function () {
            mapInfoWindowFocusTimer = null;
            var overlay = resolveMapInfoWindowOverlay(options);
            if (!overlay) return;

            if (!overlay.getAttribute('role')) {
                overlay.setAttribute('role', 'dialog');
            }
            overlay.setAttribute('aria-modal', 'true');
            if (!overlay.getAttribute('aria-label') && !overlay.getAttribute('aria-labelledby')) {
                var titleEl = overlay.querySelector('.overlay-header strong, strong');
                if (titleEl && titleEl.textContent) {
                    overlay.setAttribute('aria-label', titleEl.textContent.trim());
                } else {
                    overlay.setAttribute('aria-label', '매장 정보');
                }
            }
            if (!overlay.hasAttribute('tabindex')) {
                overlay.setAttribute('tabindex', '-1');
            }

            bindMapInfoWindowFocusTrap(overlay, {
                onEscape: options.onEscape
            });

            var focusEl = null;
            if (options.focusSelector) {
                focusEl = overlay.querySelector(options.focusSelector);
            }
            if (!focusEl) {
                focusEl = overlay.querySelector('.btn-overlay-close');
            }
            if (!focusEl) {
                var focusables = getMapInfoWindowFocusable(overlay);
                focusEl = focusables.length ? focusables[0] : overlay;
            }

            if (focusEl && typeof focusEl.focus === 'function') {
                focusEl.focus();
            }
        }, 0);
    }

    /**
     * InfoWindow 닫힌 뒤 마커/이전 요소로 포커스 복귀 + 트랩 해제
     * @param {HTMLElement|string} [returnFocus]
     */
    function restoreMapInfoWindowFocus(returnFocus) {
        unbindMapInfoWindowFocusTrap();

        var el = returnFocus;
        if (typeof el === 'string') {
            el = document.querySelector(el);
        }
        if (!el || typeof el.focus !== 'function') {
            el = mapInfoWindowLastFocus;
        }
        mapInfoWindowLastFocus = null;

        if (el && typeof el.focus === 'function') {
            window.setTimeout(function () {
                el.focus();
            }, 0);
        }
    }

    /**
     * InfoWindow open/close 이벤트에 포커스 처리 바인딩
     * @param {naver.maps.InfoWindow} infowindow
     * @param {HTMLElement|string} [triggerEl] - 연 마커/버튼 (닫힐 때 복귀)
     * @param {Object} [options] - focusMapInfoWindow 옵션 + map
     */
    function bindMapInfoWindowFocus(infowindow, triggerEl, options) {
        if (!infowindow || typeof naver === 'undefined' || !naver.maps || !naver.maps.Event) return;

        options = options || {};

        var resolveTrigger = function () {
            if (typeof triggerEl === 'string') {
                return document.querySelector(triggerEl);
            }
            if (triggerEl && triggerEl.nodeType === 1) {
                return triggerEl;
            }
            if (typeof options.returnFocus === 'string') {
                return document.querySelector(options.returnFocus);
            }
            if (options.returnFocus && options.returnFocus.nodeType === 1) {
                return options.returnFocus;
            }
            return null;
        };

        naver.maps.Event.addListener(infowindow, 'open', function () {
            focusMapInfoWindow({
                map: options.map || options.target,
                target: options.target || options.map,
                overlay: options.overlay,
                overlaySelector: options.overlaySelector,
                focusSelector: options.focusSelector,
                returnFocus: resolveTrigger() || document.activeElement
            });
        });

        naver.maps.Event.addListener(infowindow, 'close', function () {
            restoreMapInfoWindowFocus(resolveTrigger() || options.returnFocus);
        });
    }

    /**
     * @namespace NaverMapA11y
     * 네이버 지도 줌 버튼 · InfoWindow 포커스 공용 API
     *
     * @example
     * // 줌 버튼
     * NaverMapA11y.setZoom('#ShopListMap', map, isZooming);
     * // 또는 기존 호환
     * setMapZoomA11y('#ShopListMap', map, isZooming);
     *
     * @example
     * // InfoWindow 포커스 바인딩
     * bindMapInfoWindowFocus(infowindow, document.getElementById('Marker0'), {
     *   map: '#ShopListMap'
     * });
     *
     * @example
     * // 직접 호출
     * focusMapInfoWindow({ map: '#ShopListMap', returnFocus: balloonEl });
     * restoreMapInfoWindowFocus(balloonEl);
     */
    var NaverMapA11y = {
        setZoom: setMapZoomA11y,
        focusInfoWindow: focusMapInfoWindow,
        restoreInfoWindowFocus: restoreMapInfoWindowFocus,
        bindInfoWindowFocus: bindMapInfoWindowFocus,
        bindMarkerKeyboard: bindMapMarkerKeyboard
    };

    // =========================================================================
    // HeaderUI — 스크롤 시 모바일 헤더 · 맨위로 포커스
    // =========================================================================

    function focusHeaderLogo() {
        var isDesktop = $(window).width() > 767;
        var $logoWrap = isDesktop
            ? $('.header .header-wrap.pc .logo')
            : $('.header .header-wrap.mobile .logo');
        var $logoLink = $logoWrap.find('a').eq(0);

        if (!$logoLink.length) {
            $logoLink = $logoWrap.find('a').first();
        }

        if ($logoLink.length) {
            $logoLink.focus();
            return;
        }

        $logoWrap.attr('tabindex', '-1').focus();
    }

    function popHeaderFixed(scrollTop) {
        // 팝업 헤더 스크롤 시 고정
        if (scrollTop > 100) {
            $('.popup-wrap .popup-header').addClass('fixed');
        } else {
            $('.popup-wrap .popup-header').removeClass('fixed');
        }

        // 플로팅 블록 스크롤 방향에 따라 숨김/노출
        if (scrollTop > 200) {
            $('.floating-block').addClass('active');
        } else {
            $('.floating-block').removeClass('active');
        }

        // 모바일 헤더 스크롤 방향에 따라 숨김/노출
        if (scrollTop > prevScTop && scrollTop > 0) {
            $(header).addClass('hide');
        } else {
            $(header).removeClass('hide');
        }

        if (scrollTop > 10) {
            $('.breadcrumb-wrap .mo-nav').addClass('fixed');
        } else {
            $('.breadcrumb-wrap .mo-nav').removeClass('fixed');
        }

        prevScTop = scrollTop;
    }

    function headerFixed(){
        $(".header .header-wrap.mobile .gnb-mobile-inner").on('scroll', function(){
            if ($(this).scrollTop() > 10) {
                $(".gnb-mobile-top").addClass("fixed");
            } else {
                $(".gnb-mobile-top").removeClass("fixed")
            }
        });
    }

    /** @namespace HeaderUI */
    var HeaderUI = {
        focusLogo: focusHeaderLogo,
        onScroll: popHeaderFixed,
    };

    function storeLocatorDefault() {
        if ($(moTabControlBtn).length > 0 && $(tabWrap).length > 0) {
            var text = $(tabWrap + ' .tabs > li.on a').text().trim();
            var searchType = '';
            switch (text) {
                case '검색': searchType = '직접입력'; break;
                case '지역': searchType = '지역'; break;
                case '지하철역': searchType = '지하철역'; break;
            }
            var typeTextEl = $(moTabControlBtn).find('.search-type-text')[0];
            if (typeTextEl && typeTextEl.textContent !== searchType) {
                typeTextEl.textContent = searchType;
            }
            if (_thsW > 767) {
                if ($(tabWrap).attr('style')) {
                    $(tabWrap).removeAttr('style');
                }
                isTabOpen = false;
            } else if (!isTabOpen && $(tabWrap).attr('style')) {
                $(tabWrap).removeAttr('style');
            }
        }
    }

    // -------------------------------------------------------------------------
    // 매장 찾기 — 탭 드롭다운
    // -------------------------------------------------------------------------

    function closeStoreTabDropdown(options) {
        if (_thsW > 767) return;

        $(tabWrap).hide();
        isTabOpen = false;
        $(moTabControlBtn).attr('aria-expanded', 'false');
        $(document).off('click.storeTabOutside');

        if (options && options.restoreFocus) {
            $(moTabControlBtn).focus();
        }
    }

    /** @namespace StoreLocator — 매장 찾기 탭 */
    var StoreLocator = {
        reset: storeLocatorDefault,
        closeTabDropdown: closeStoreTabDropdown
    };

    // =========================================================================
    // MoGnbUI — 모바일 전체 메뉴 (VoiceOver/TalkBack 포커스 트랩)
    // =========================================================================

    // --- 포커스 트랩 헬퍼 ---

    function getMoGnbFocusable() {
        if (!moGnb.$wrap || !moGnb.$wrap.length) return $();
        // 루프용 센티널은 Tab 목록에서 제외 (닫기↔로그인 순환은 keydown/focus 로 처리)
        return A11y.getFocusable(moGnb.$wrap).not('.mo-gnb-sentinel, .mo-gnb-focus-loop');
    }

    function isMoGnbAndroid() {
        return isAndroid();
    }

    /** 터치/마우스 click vs 키보드(Enter/Space) click 구분 */
    function isMoGnbPointerEvent(e) {
        var oe = e.originalEvent || e;
        var pointerType = oe.pointerType;
        if (pointerType === 'touch' || pointerType === 'pen' || pointerType === 'mouse') return true;
        if (typeof e.detail === 'number' && e.detail === 0) return false;
        if (e.detail > 0) return true;
        return false;
    }

    /** 실제 스크롤 컨테이너 (.gnb-mobile-inner 에 overflow-y:auto) */
    function getMoGnbScrollContainer() {
        if (!moGnb.$wrap || !moGnb.$wrap.length) return null;
        var inner = moGnb.$wrap.find('.gnb-mobile-inner')[0];
        return inner || moGnb.$wrap[0];
    }

    /**
     * 포커스된 메뉴 항목이 스크롤 영역 밖이면 컨테이너를 이동.
     * - focus({ preventScroll:true }) 사용으로 브라우저 자동 스크롤이 막히거나
     *   구형 WebView 마다 동작이 달라 수동 보정 (scrollTop) 을 기본으로 씀.
     * - scrollIntoView options 는 구형 Android WebView 미지원일 수 있어 try + fallback.
     */
    function scrollMoGnbFocusedIntoView(el) {
        if (!moGnb.isOpen || !el || !moGnb.$wrap || !moGnb.$wrap[0].contains(el)) return;
        if (el === moGnb.$wrap[0]) return;
        if ($(el).hasClass('mo-gnb-focus-loop') || $(el).hasClass('gnb-mobile-close')) return;

        var scroller = getMoGnbScrollContainer();
        if (!scroller || !scroller.contains(el)) return;

        // 1) 표준 API 시도 (nearest 옵션 미지원 기기 대비 boolean 폴백)
        if (typeof el.scrollIntoView === 'function') {
            try {
                el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            } catch (errOpts) {
                try {
                    el.scrollIntoView(false);
                } catch (errBool) { /* noop */ }
            }
        }

        // 2) 수동 보정 — 잘못된 조상(body 등)만 스크롤된 경우·미지원 기기 대응
        //    sticky .gnb-mobile-top 높이만큼 상단 여유 확보
        var elRect = el.getBoundingClientRect();
        var scRect = scroller.getBoundingClientRect();
        var sticky = scroller.querySelector('.gnb-mobile-top');
        var topPad = 0;
        if (sticky) {
            topPad = sticky.getBoundingClientRect().height || 0;
        }

        var visibleTop = scRect.top + topPad;
        var visibleBottom = scRect.bottom;
        var delta = 0;

        if (elRect.top < visibleTop) {
            delta = elRect.top - visibleTop;
        } else if (elRect.bottom > visibleBottom) {
            delta = elRect.bottom - visibleBottom;
        }

        if (delta !== 0 && typeof scroller.scrollTop === 'number') {
            scroller.scrollTop += delta;
        }
    }

    /**
     * 목적지 초점 이동 (Android TalkBack 은 즉시 focus() 를 무시할 수 있어 재시도)
     * — 루프 버튼 구조는 유지하고, 이동만 보강
     */
    function moveMoGnbFocus(el, attempt) {
        if (!moGnb.isOpen || !el) return;

        var tries = attempt || 0;

        try {
            el.focus({ preventScroll: true });
        } catch (err) {
            try { el.focus(); } catch (err2) { /* noop */ }
        }

        if (document.activeElement !== el && tries < 20) {
            clearMoGnbFocusRetry();
            moGnb.focusRetryTimer = setTimeout(function () {
                moveMoGnbFocus(el, tries + 1);
            }, tries < 5 ? 16 : 50);
            return;
        }

        scrollMoGnbFocusedIntoView(el);
    }

    function focusMoGnbLoopTarget(which) {
        var $focusable = getMoGnbFocusable();
        if (!$focusable.length) {
            if (moGnb.$wrap && moGnb.$wrap.length) {
                moveMoGnbFocus(moGnb.$wrap.attr('tabindex', '-1')[0], 0);
            }
            return;
        }
        var el = which === 'last'
            ? $focusable[$focusable.length - 1]
            : $focusable[0];

        // 포커스 받는 요소에 tabindex=-1 부여 후 focus
        // (프로그래밍 포커스 보장. 네이티브 a/button 도 TalkBack 이동 시 권장되는 패턴)
        // Tab 순서가 깨지지 않도록 이동 후 원래 값 복원
        if (el && !el.hasAttribute('data-mo-gnb-recv-tab')) {
            el.setAttribute(
                'data-mo-gnb-recv-tab',
                el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : ''
            );
        }
        if (el) {
            el.setAttribute('tabindex', '-1');
        }

        moveMoGnbFocus(el, 0);

        if (el) {
            clearTimeout(el._moGnbRecvTabRestore);
            el._moGnbRecvTabRestore = setTimeout(function () {
                if (!el || !el.parentNode) return;
                var prev = el.getAttribute('data-mo-gnb-recv-tab');
                el.removeAttribute('data-mo-gnb-recv-tab');
                if (prev === '' || prev == null) {
                    el.removeAttribute('tabindex');
                } else {
                    el.setAttribute('tabindex', prev);
                }
            }, 700);
        }
    }

    /**
     * Android TalkBack: DOM focus 는 옮겨져도 접근성 초점이 루프 버튼에 남는 경우가 있음.
     * 이동하는 동안만 해당 루프 버튼을 a11y 트리에서 잠시 제외 (iOS 경로는 변경 없음).
     */
    function runMoGnbLoopRedirect(loopEl, which) {
        if (!moGnb.isOpen || !loopEl) return;

        var android = isMoGnbAndroid();
        if (android) {
            loopEl.setAttribute('aria-hidden', 'true');
            loopEl.setAttribute('tabindex', '-1');
        }

        focusMoGnbLoopTarget(which);

        if (android) {
            clearTimeout(loopEl._moGnbLoopRestore);
            loopEl._moGnbLoopRestore = setTimeout(function () {
                if (!loopEl || !loopEl.parentNode) return;
                loopEl.removeAttribute('aria-hidden');
                loopEl.removeAttribute('tabindex');
            }, 700);
        }
    }

    /** 닫기 다음(끝) · 로그인 이전(시작) 루프 — VoiceOver/TalkBack 스와이프 이탈 방지 */
    function initMoGnbFocusLoop() {
        if (!moGnb.$wrap || !moGnb.$wrap.length) return;

        // 예전 sentinel · 실험용 루프 잔여 제거 후 재생성
        moGnb.$wrap.find('.mo-gnb-sentinel, .mo-gnb-focus-loop').remove();

        var $inner = moGnb.$wrap.find('.gnb-mobile-inner').first();
        var $close = moGnb.$wrap.find('.gnb-mobile-close').first();
        if (!$inner.length || !$close.length) return;

        var $start = $(
            '<button type="button" class="mo-gnb-focus-loop is-start">' +
                '<span class="blind">메뉴 마지막으로</span>' +
            '</button>'
        );
        var $end = $(
            '<button type="button" class="mo-gnb-focus-loop is-end">' +
                '<span class="blind">로그인 해주세요로 이동</span>' +
            '</button>'
        );

        $inner.prepend($start);
        $close.after($end);

        // focus 단독은 Android에서 접근성 초점만 머무는 경우가 많음.
        // focusin(스와이프) + click(TalkBack 두 번 탭 = 사용자 제스처)으로 넘김이 더 확실함.
        $start.off('focus focusin click' + MO_GNB_A11Y_NS)
            .on('focusin' + MO_GNB_A11Y_NS + ' click' + MO_GNB_A11Y_NS, function (e) {
                if (!moGnb.isOpen) return;
                if (e.type === 'click') e.preventDefault();
                var loopEl = this;
                clearTimeout(loopEl._moGnbRedirectTimer);
                // click 은 제스처라 즉시, focusin 은 안내 직후 넘김
                loopEl._moGnbRedirectTimer = setTimeout(function () {
                    runMoGnbLoopRedirect(loopEl, 'last'); // 닫기
                }, e.type === 'click' ? 0 : 100);
            });

        $end.off('focus focusin click' + MO_GNB_A11Y_NS)
            .on('focusin' + MO_GNB_A11Y_NS + ' click' + MO_GNB_A11Y_NS, function (e) {
                if (!moGnb.isOpen) return;
                if (e.type === 'click') e.preventDefault();
                var loopEl = this;
                clearTimeout(loopEl._moGnbRedirectTimer);
                loopEl._moGnbRedirectTimer = setTimeout(function () {
                    runMoGnbLoopRedirect(loopEl, 'first'); // 로그인 해주세요
                }, e.type === 'click' ? 0 : 100);
            });
    }

    function clearMoGnbFocusRetry() {
        if (moGnb.focusRetryTimer) {
            clearTimeout(moGnb.focusRetryTimer);
            moGnb.focusRetryTimer = null;
        }
    }

    function clearMoGnbFocusTimers() {
        clearMoGnbFocusRetry();
        if (moGnb.focusSettleTimer) {
            clearTimeout(moGnb.focusSettleTimer);
            moGnb.focusSettleTimer = null;
        }
    }

    function disableMoGnbFocusable(el) {
        if (!moGnb.$wrap || moGnb.$wrap[0].contains(el)) return;

        var i;
        for (i = 0; i < moGnb.disabledFocusables.length; i++) {
            if (moGnb.disabledFocusables[i].el === el) return;
        }

        moGnb.disabledFocusables.push({
            el: el,
            hadTabindex: el.hasAttribute('tabindex'),
            prev: el.getAttribute('tabindex')
        });
        el.setAttribute('tabindex', '-1');
    }

    function disableMoGnbFocusIn($container) {
        $container.find(MO_GNB_FOCUSABLE).each(function () {
            disableMoGnbFocusable(this);
        });

        if ($container.is(MO_GNB_FOCUSABLE)) {
            disableMoGnbFocusable($container[0]);
        }
    }

    function restoreMoGnbDisabledFocus() {
        moGnb.disabledFocusables.forEach(function (item) {
            if (item.hadTabindex) {
                item.el.setAttribute('tabindex', item.prev);
            } else {
                item.el.removeAttribute('tabindex');
            }
        });
        moGnb.disabledFocusables = [];
    }

    // --- 배경 aria-hidden · inert · visibility 차단 ---

    function markMoGnbAriaHidden($el) {
        if (!moGnb.$wrap || !$el.length || moGnb.$wrap[0].contains($el[0])) return;

        // 전체 메뉴 오픈 중 독바(.mobile-status-bar)는 aria-hidden/inert 제외
        if ($el.is('.mobile-status-bar') || $el.closest('.mobile-status-bar').length > 0) {
            return;
        }

        var el = $el[0];
        var i;
        for (i = 0; i < moGnb.hiddenElements.length; i++) {
            if (moGnb.hiddenElements[i].el === el) return;
        }

        moGnb.hiddenElements.push({
            el: el,
            hadAttr: el.hasAttribute('aria-hidden'),
            prev: $el.attr('aria-hidden'),
            hadInert: ('inert' in el) ? !!el.inert : false,
            hideVisibility: true,
            prevVisibility: el.style.visibility,
            prevVisibilityPriority: el.style.getPropertyPriority
                ? el.style.getPropertyPriority('visibility')
                : ''
        });
        $el.attr('aria-hidden', 'true');
        // Android Voice Assistant / TalkBack 스와이프 이탈 차단 (aria-modal 만으론 부족)
        if ('inert' in el) {
            el.inert = true;
        }
        el.style.setProperty('visibility', 'hidden', 'important');
        disableMoGnbFocusIn($el);
    }

    function restoreMoGnbBackground() {
        moGnb.hiddenElements.forEach(function (item) {
            var $el = $(item.el);

            if (item.hadAttr) {
                $el.attr('aria-hidden', item.prev);
            } else {
                $el.removeAttr('aria-hidden');
            }

            if ('inert' in item.el) {
                item.el.inert = !!item.hadInert;
            }

            if (item.hideVisibility) {
                if (item.prevVisibility) {
                    item.el.style.setProperty(
                        'visibility',
                        item.prevVisibility,
                        item.prevVisibilityPriority || ''
                    );
                } else {
                    item.el.style.removeProperty('visibility');
                }
            }
        });
        moGnb.hiddenElements = [];
        restoreMoGnbDisabledFocus();
    }

    /**
     * 메뉴(dialog)를 제외한 나머지 DOM 을 접근성/포커스에서 제외
     * - body 직계 → 메뉴 조상 경로의 형제까지 모두 처리
     * - aria-hidden + inert + visibility:hidden (Android Voice Assistant 대응)
     */
    function hideMoGnbBackground() {
        if (moGnb.hiddenElements.length) {
            restoreMoGnbBackground();
        }

        var menuEl = moGnb.$wrap && moGnb.$wrap[0];
        if (!menuEl) return;

        $('body').children().each(function () {
            if (this.contains(menuEl)) {
                var node = menuEl;
                while (node && node !== this) {
                    var parent = node.parentNode;
                    if (!parent) break;

                    $(parent).children().each(function () {
                        if (this === node || this.contains(menuEl)) return;
                        markMoGnbAriaHidden($(this));
                    });
                    node = parent;
                }
                return;
            }

            markMoGnbAriaHidden($(this));
        });
    }

    // --- dialog ARIA · Tab/Escape 포커스 트랩 ---

    function wrapMoGnbFocus() {
        focusMoGnbLoopTarget('first');
    }

    function setMoGnbDialogA11y(isOpen) {
        if (!moGnb.$wrap) return;

        if (isOpen) {
            // tabindex=-1: 프로그래밍 포커스만 허용(탭 순서 제외) — 문제 원인 가능성 낮음
            // role=dialog: 랜드마크 역할 — iOS에 유리
            // aria-modal: iOS VoiceOver 트랩에 필요. Android TalkBack 은 지원이 약하고
            //   DOM focus() 와 접근성 초점 동기화를 방해하는 사례가 있어 Android 에선 생략
            var attrs = {
                role: 'dialog',
                tabindex: '-1',
                'aria-hidden': 'false'
            };
            if (!isMoGnbAndroid()) {
                attrs['aria-modal'] = 'true';
            } else {
                moGnb.$wrap.removeAttr('aria-modal');
            }
            moGnb.$wrap.attr(attrs);
            if (!moGnb.$wrap.attr('aria-label')) {
                moGnb.$wrap.attr('aria-label', '전체 메뉴');
            }
        } else {
            moGnb.$wrap.attr({
                'aria-hidden': 'true',
                tabindex: '-1'
            }).removeAttr('role aria-modal');
        }
    }

    /**
     * 메뉴 오픈 후 초기 초점 (TalkBack 대응)
     * - 트리거(독바)를 바로 aria-hidden 하면 Android에서 초점 유실 → 초점 안착 후 배경 숨김
     * - 애니메이션 중 focus() 무시 대비 재시도
     */
    function focusMoGnbInitial(attempt) {
        if (!moGnb.isOpen || !moGnb.$wrap || !moGnb.$wrap.length) return;

        var tries = attempt || 0;
        var wrapEl = moGnb.$wrap[0];
        var $focusable = getMoGnbFocusable();
        var target = $focusable.length ? $focusable[0] : wrapEl;

        try {
            target.focus({ preventScroll: true });
        } catch (err) {
            try { target.focus(); } catch (err2) { /* noop */ }
        }

        var landed = wrapEl.contains(document.activeElement);

        if (!landed && tries < 6) {
            clearMoGnbFocusRetry();
            moGnb.focusRetryTimer = setTimeout(function () {
                focusMoGnbInitial(tries + 1);
            }, tries < 2 ? 50 : 120);
            return;
        }

        // 초점이 메뉴 안에 들어온 뒤 배경 차단 (트리거 aria-hidden 타이밍 이슈 방지)
        if (!moGnb.hiddenElements.length) {
            hideMoGnbBackground();
        }

        // 그래도 밖에 있으면 한 번 더 당김
        if (!wrapEl.contains(document.activeElement)) {
            wrapMoGnbFocus();
        }
    }

    function unbindMoGnbFocusTrap() {
        if (!moGnb.$wrap) return;

        moGnb.$wrap.off('keydown' + MO_GNB_A11Y_NS);
        moGnb.$wrap.off('focusin' + MO_GNB_A11Y_NS);
        $(document).off('focusin' + MO_GNB_A11Y_NS);
        document.removeEventListener('focusin', onMoGnbDocFocusIn, true);
    }

    function onMoGnbDocFocusIn(e) {
        if (!moGnb.isOpen || !moGnb.$wrap) return;
        if (moGnb.$wrap[0].contains(e.target)) return;
        // 오픈 직후 트리거→메뉴 이동 중이면 가로채지 않음
        if (!moGnb.hiddenElements.length) return;

        wrapMoGnbFocus();
    }

    function bindMoGnbFocusTrap() {
        unbindMoGnbFocusTrap();

        // Tab 순환 + Escape 닫기 (닫기는 마크업 마지막 focusable)
        moGnb.$wrap.on('keydown' + MO_GNB_A11Y_NS, function (e) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                moGnb.closeByPointer = false;
                startMoGnbClose();
                return;
            }

            if (e.key !== 'Tab' && e.keyCode !== 9) return;

            var $focusable = getMoGnbFocusable();
            if (!$focusable.length) return;

            var first = $focusable[0];
            var last = $focusable[$focusable.length - 1];
            var active = document.activeElement;

            if (e.shiftKey) {
                if (
                    active === first ||
                    active === moGnb.$wrap[0] ||
                    $(active).hasClass('mo-gnb-focus-loop')
                ) {
                    e.preventDefault();
                    moveMoGnbFocus(last, 0);
                }
            } else if (active === last || $(active).hasClass('mo-gnb-focus-loop')) {
                // 닫기 다음 → 로그인 해주세요
                e.preventDefault();
                moveMoGnbFocus(first, 0);
            }
        });

        // TalkBack/VoiceOver 스와이프·Tab 으로 메뉴 항목 초점 시 스크롤 영역 안으로
        moGnb.$wrap.on('focusin' + MO_GNB_A11Y_NS, function (e) {
            scrollMoGnbFocusedIntoView(e.target);
        });

        // capture 단계 — 버블보다 먼저 메뉴 밖으로 나간 DOM 포커스 복귀
        document.addEventListener('focusin', onMoGnbDocFocusIn, true);
    }

    // --- 열기 / 닫기 ---

    function finishMoGnbClose() {
        clearMoGnbFocusTimers();
        var scroller = getMoGnbScrollContainer();
        if (scroller) scroller.scrollTop = 0;
        moGnb.$wrap.scrollTop(0);
        moGnb.$wrap.off('animationend' + MO_GNB_ANIM_NS);
        moGnb.$wrap.removeClass('is-close').css('display', 'none');
        setMoGnbDialogA11y(false);

        var closeByPointer = moGnb.closeByPointer;
        var triggerEl = moGnb.$trigger && moGnb.$trigger[0];
        var wrapEl = moGnb.$wrap && moGnb.$wrap[0];
        var active = document.activeElement;
        moGnb.closeByPointer = false;

        if (closeByPointer) {
            // iOS: 닫은 뒤 트리거에 focus 하면
            // 1) 독바 scroll-lock(body position:fixed) 이 켜져 스크롤이 안 됨
            // 2) 같은 버튼 다음 tap click 이 무시되어 재오픈이 안 됨
            // 터치로 닫을 때는 opener 로 포커스를 되돌리지 않고, 메뉴/트리거에 남은 포커스만 해제
            if (active && typeof active.blur === 'function') {
                if (
                    (wrapEl && wrapEl.contains(active)) ||
                    (triggerEl && (active === triggerEl || triggerEl.contains(active)))
                ) {
                    active.blur();
                }
            }
        } else {
            moGnb.skipToolbarLock = true;
            if (triggerEl) {
                try {
                    triggerEl.focus({ preventScroll: true });
                } catch (err) {
                    try { triggerEl.focus(); } catch (err2) { /* noop */ }
                }
            } else if (moGnb.lastFocus && typeof moGnb.lastFocus.focus === 'function') {
                try { moGnb.lastFocus.focus({ preventScroll: true }); } catch (err) { moGnb.lastFocus.focus(); }
            }
        }

        moGnb.lastFocus = null;

        if (moGnb.$familySiteWrap && moGnb.$familySiteWrap.length) {
            moGnb.$familySiteWrap.removeClass('open').attr('aria-expanded', 'false');
        }
    }

    function bindMoGnbCloseEnd() {
        moGnb.$wrap.off('animationend' + MO_GNB_ANIM_NS);
        moGnb.$wrap.on('animationend' + MO_GNB_ANIM_NS, function (e) {
            if (e.originalEvent && e.originalEvent.animationName !== 'moGnbClose') return;
            finishMoGnbClose();
        });
    }

    function startMoGnbClose() {
        clearMoGnbFocusTimers();
        moGnb.$menuItem.removeClass('active');
        moGnb.$wrap.removeClass('active').addClass('is-close');
        moGnb.$trigger.attr('aria-expanded', 'false');
        unbindMoGnbFocusTrap();
        restoreMoGnbBackground();
        bindMoGnbCloseEnd();
        $('body, html').css({ overflow: '', height: '' });

        // iOS: animationend 전에 독바 포커스가 남아 있으면 scroll-lock / 재오픈 실패
        if (moGnb.closeByPointer) {
            var triggerEl = moGnb.$trigger && moGnb.$trigger[0];
            var wrapEl = moGnb.$wrap && moGnb.$wrap[0];
            var active = document.activeElement;
            if (active && typeof active.blur === 'function') {
                if (
                    (wrapEl && wrapEl.contains(active)) ||
                    (triggerEl && (active === triggerEl || triggerEl.contains(active)))
                ) {
                    active.blur();
                }
            }
        }

        moGnb.isOpen = false;
        // aria-hidden 은 애니메이션 후 finish 에서 확정 (닫는 동안에도 스크린리더가 메뉴를 읽지 않도록 즉시 숨김)
        moGnb.$wrap.attr('aria-hidden', 'true');
    }

    function openMoGnbMenu() {
        clearMoGnbFocusTimers();
        moGnb.lastFocus = document.activeElement;
        moGnb.$menuItem.siblings().removeClass('active');
        moGnb.$menuItem.addClass('active');
        moGnb.$wrap.off('animationend' + MO_GNB_ANIM_NS);
        moGnb.$wrap.removeClass('is-close');
        // CSS .active { display:block } 과 병행.
        // 닫기 시 finish 에서 inline display:none 을 넣으므로, 재오픈 때 inline 을 block 으로
        // 다시 켜야 함. 또한 닫기 애니메이션 중 .active 제거 후에도 inline block 이 유지돼야 함.
        moGnb.$wrap.css('display', 'block').addClass('active');
        setMoGnbDialogA11y(true);
        bindMoGnbFocusTrap();
        moGnb.$trigger.attr('aria-expanded', 'true');
        // $('body, html').addClass('scroll-fixed');
        $('body, html').css({ overflow: 'hidden', height: 'auto' });
        moGnb.isOpen = true;

        // 동기 초점 시도 후 배경 즉시 차단
        // (지연 숨김 동안 Android Voice Assistant 가 툴바/본문으로 스와이프하는 것 방지)
        var $focusable = getMoGnbFocusable();
        var syncTarget = $focusable.length ? $focusable[0] : moGnb.$wrap[0];
        try {
            syncTarget.focus({ preventScroll: true });
        } catch (err) {
            try { syncTarget.focus(); } catch (err2) { /* noop */ }
        }
        hideMoGnbBackground();

        window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () {
                focusMoGnbInitial(0);
            });
        });

        // 슬라이드 애니메이션(0.5s) 종료 후 초점 재확인
        moGnb.focusSettleTimer = setTimeout(function () {
            moGnb.focusSettleTimer = null;
            if (!moGnb.isOpen) return;
            if (!moGnb.hiddenElements.length) {
                hideMoGnbBackground();
            }
            if (!moGnb.$wrap[0].contains(document.activeElement)) {
                focusMoGnbInitial(0);
            }
        }, 520);
    }

    // --- DOM · 링크 ARIA 초기화 ---

    function initMoGnbSentinels() {
        initMoGnbFocusLoop();
    }

    /** 헤더당 1회: DOM·ARIA 초기화 */
    function initMoGnbHeader($header, $familySiteWrap) {
        moGnb.$wrap = $header.find('.header-wrap.mobile .gnb-mobile-wrap');
        moGnb.$menuItem = $('.mobile-status-bar .list-item.menu');
        moGnb.$trigger = moGnb.$menuItem.find('a');
        moGnb.$familySiteWrap = $familySiteWrap;

        if (!moGnb.$wrap.length) return;

        if (!moGnb.$wrap.attr('id')) {
            moGnb.$wrap.attr('id', 'gnbMobileMenu');
        }

        // region/tabindex=0 잔여 제거 → dialog 전용으로 정규화
        moGnb.$wrap.attr({
            'aria-hidden': 'true',
            tabindex: '-1'
        }).removeAttr('role');

        if (!moGnb.$wrap.attr('aria-label')) {
            moGnb.$wrap.attr('aria-label', '전체 메뉴');
        }

        moGnb.$trigger.attr({
            'aria-haspopup': 'dialog',
            'aria-expanded': 'false',
            'aria-controls': moGnb.$wrap.attr('id')
        });

        initMoGnbSentinels();
        initMoGnbLinkA11y();
    }

    /**
     * 메뉴 링크 접근성
     * - dl/dt/dd 개별 포커스(TalkBack 스와이프) 방지
     * - a에 통합 aria-label, 내부 dl 은 aria-hidden
     */
    function initMoGnbLinkA11y() {
        if (!moGnb.$wrap || !moGnb.$wrap.length) return;

        moGnb.$wrap.find('.gnb-mobile .section ul li a').each(function () {
            var $link = $(this);
            var $dl = $link.find('dl').first();
            if (!$dl.length) {
                $link.attr('data-a11y-bound', 'true');
                return;
            }

            var title = $.trim($dl.find('dt').first().text());
            var desc = $.trim($dl.find('dd').first().text());
            var label = title;

            if (desc) {
                label += ', ' + desc;
            }

            if ($link.attr('target') === '_blank') {
                label += ', 새 창';
            }

            if (label) {
                $link.attr('aria-label', label);
            }
            $dl.attr('aria-hidden', 'true');
            $link.attr('data-a11y-bound', 'true');
        });
    }

    /** document 레벨 이벤트는 페이지당 1회만 바인딩 */
    function bindMoGnbDocumentEvents() {
        if (moGnbDocumentBound) return;
        moGnbDocumentBound = true;

        $(document).on('click' + MO_GNB_A11Y_NS, '.mobile-status-bar .list-item.menu a', function (e) {
            e.preventDefault();
            moGnb.closeByPointer = isMoGnbPointerEvent(e);

            if (moGnb.isOpen) {
                startMoGnbClose();
            } else {
                openMoGnbMenu();
            }
        });

        $(document).on('click' + MO_GNB_A11Y_NS, '.gnb-mobile-close', function (e) {
            if (!moGnb.isOpen) return;
            moGnb.closeByPointer = isMoGnbPointerEvent(e);
            startMoGnbClose();
        });
    }

    /**
     * @namespace MoGnbUI
     * 모바일 전체 메뉴 공개 API
     */
    var MoGnbUI = {
        initHeader: initMoGnbHeader,
        bindDocumentEvents: bindMoGnbDocumentEvents,
        open: openMoGnbMenu,
        close: startMoGnbClose
    };

    // =========================================================================
    // PcGnb — PC 메가메뉴 / 헤더 초기화
    // =========================================================================

    function initGnb($scope) {
        getRoot($scope).find('.header').not('[data-gnb-bound]').each(function () {
            var $header = $(this);
            $header.attr('data-gnb-bound', 'true');

            // GNB mega menu
            // - 기본: 1depth hover 시 모든 .menu-category-layer 동시 노출, gnb-open → .header-inner-cont
            // - .header.renew: active li 하위만 노출, gnb-open → .header-inner
            //   (renew 는 menu-wrap 이 header-inner-cont 형제가 아님)
            var MENU_NS = '.gnbMenu';
            var isRenewHeader = $header.hasClass('renew');
            var $menuWrap = $header.find('.header-wrap.pc .menu-wrap');
            var $gnbInnerCont = $header.find('.header-wrap.pc .header-inner .header-inner-cont');
            var $gnbInner = $header.find('.header-wrap.pc .header-inner').has('.menu-wrap').first();
            var $gnbOpenTarget = isRenewHeader && $gnbInner.length ? $gnbInner : $gnbInnerCont;
            var $navList = $menuWrap.find('> .gnb-nav > ul, > ul').first();
            var $navItems = $navList.children('li');
            var $navTriggers = $navItems.children('a.depth1-tit');
            var $navLayers = $navItems.children('.menu-category-layer');
            var gnbCloseTimer = null;
            var $lastGnbTrigger = null;
            var $skipToContent = $header.find('#skipToContent');

            $skipToContent.on('click', function() {
                if(_thsW >= 767) {
                    return;
                }
                $('html, body').animate({
                    scrollTop: $('#content').offset().top - 60
                }, 10);
            });

            function setGnbTabActive($li) {
                $navItems.removeClass('active');
                $navTriggers.attr('aria-expanded', 'false');

                if (!$li || !$li.length) return;

                $li.addClass('active');
                $li.children('a.depth1-tit').attr('aria-expanded', 'true');
            }

            function syncGnbLayers($li) {
                if (isRenewHeader) {
                    $navLayers.hide();
                    if ($li && $li.length) {
                        $li.children('.menu-category-layer').show();
                    }
                    return;
                }
                $navLayers.show();
            }

            function openGnbMenu($li) {
                if ($('.header-search-wrap').hasClass('active')) return;

                cancelCloseGnbMenu();
                $gnbOpenTarget.addClass('gnb-open');
                setGnbTabActive($li);
                syncGnbLayers($li);

                if ($li && $li.length) {
                    $lastGnbTrigger = $li.children('a.depth1-tit');
                }

                $header.find('.dimmde').remove();
                $header.append('<p class="dimmde"></p>');
            }

            function closeGnbMenu() {
                clearTimeout(gnbCloseTimer);
                $gnbOpenTarget.removeClass('gnb-open');
                $navItems.removeClass('active');
                $navTriggers.attr('aria-expanded', 'false');
                $navLayers.hide();
                $header.find('.dimmde').remove();
            }

            function scheduleCloseGnbMenu() {
                clearTimeout(gnbCloseTimer);
                gnbCloseTimer = setTimeout(closeGnbMenu, 80);
            }

            function cancelCloseGnbMenu() {
                clearTimeout(gnbCloseTimer);
            }

            if ($menuWrap.length && $navItems.length) {
                $navItems.each(function (idx) {
                    var $li = $(this);
                    var $trigger = $li.children('a.depth1-tit');
                    var $layer = $li.children('.menu-category-layer');

                    if (!$trigger.length || !$layer.length) return;

                    if (!$layer.attr('id')) {
                        $layer.attr('id', 'gnb-menu-layer-' + idx);
                    }
                    if (!$trigger.attr('aria-haspopup')) {
                        $trigger.attr('aria-haspopup', 'true');
                    }
                    if (!$trigger.attr('aria-expanded')) {
                        $trigger.attr('aria-expanded', 'false');
                    }
                    if (!$trigger.attr('aria-controls')) {
                        $trigger.attr('aria-controls', $layer.attr('id'));
                    }

                    $layer.hide();
                });

                $menuWrap.on('mouseenter' + MENU_NS, cancelCloseGnbMenu);
                $menuWrap.on('mouseleave' + MENU_NS, scheduleCloseGnbMenu);

                $navTriggers.on('mouseenter' + MENU_NS, function () {
                    openGnbMenu($(this).parent('li'));
                });

                $navLayers.on('mouseenter' + MENU_NS, function () {
                    openGnbMenu($(this).parent('li'));
                });

                $navTriggers.on('focusin' + MENU_NS, function () {
                    $('.header-search-wrap').removeClass('active');
                    openGnbMenu($(this).parent('li'));
                });

                $menuWrap.on('focusout' + MENU_NS, function () {
                    var zone = this;

                    setTimeout(function () {
                        if (!zone.contains(document.activeElement)) {
                            closeGnbMenu();
                        }
                    }, 0);
                });

                $menuWrap.on('click' + MENU_NS, '.dimmde', function () {
                    var $trigger = $lastGnbTrigger && $lastGnbTrigger.length ? $lastGnbTrigger : $navTriggers.first();

                    closeGnbMenu();

                    if ($trigger.length) {
                        $trigger.focus();
                    }
                });

                $menuWrap.on('keydown' + MENU_NS, function (e) {
                    if (e.key !== 'Escape' && e.key !== 'Esc') return;

                    var $trigger = $lastGnbTrigger && $lastGnbTrigger.length ? $lastGnbTrigger : $navTriggers.first();

                    closeGnbMenu();

                    if ($trigger.length) {
                        $trigger.focus();
                    }
                    e.preventDefault();
                });

                $navTriggers.on('keydown' + MENU_NS, function (e) {
                    var idx = $navTriggers.index(this);
                    var nextIdx = -1;

                    if (e.key === 'ArrowRight') {
                        nextIdx = idx + 1;
                    } else if (e.key === 'ArrowLeft') {
                        nextIdx = idx - 1;
                    }

                    if (nextIdx >= 0 && nextIdx < $navTriggers.length) {
                        $navTriggers.eq(nextIdx).focus();
                        e.preventDefault();
                    }
                });
            }

            // 로그인 툴팁 레이어
            var NS = '.myTooltip';
            var $tooltips = $header.find('.my-tooltip');

            function openMyTooltip($icon) {
                var $detail = $icon.next('.my-tooltip-detail');
                $icon.attr('aria-expanded', 'true');
                $detail.addClass('active');
                return $detail;
            }

            function closeMyTooltip($tooltip) {
                $tooltip.find('.login-icon').attr('aria-expanded', 'false');
                $tooltip.find('.my-tooltip-detail').removeClass('active');
            }

            $tooltips.find('.login-icon').each(function () {
                var $icon = $(this);
                if (!$icon.attr('aria-haspopup')) {
                    $icon.attr('aria-haspopup', 'true');
                }
            });

            $tooltips.find('.login-icon').on('mouseenter' + NS, function () {
                openMyTooltip($(this));
            });

            $tooltips.on('mouseleave' + NS, function () {
                var $tooltip = $(this);
                var hadFocusInside = $tooltip[0].contains(document.activeElement);

                closeMyTooltip($tooltip);

                if (hadFocusInside) {
                    $tooltip.find('.login-icon').focus();
                }
            });

            $tooltips.find('.login-icon').on('focusin' + NS, function () {
                openMyTooltip($(this));
            });

            $tooltips.on('focusout' + NS, function () {
                var $tooltip = $(this);

                setTimeout(function () {
                    if (!$tooltip[0].contains(document.activeElement)) {
                        closeMyTooltip($tooltip);
                    }
                }, 0);
            });

            $tooltips.on('keydown' + NS, function (e) {
                if (e.key !== 'Escape' && e.key !== 'Esc') return;

                var $tooltip = $(this);
                var $icon = $tooltip.find('.login-icon');

                closeMyTooltip($tooltip);
                $icon.focus();
                e.preventDefault();
            });

            // 패밀리 사이트
            var $familySiteWrap = $header.find('.gnb-link .ui_dropdown_wrap');
            var $familySiteBtn = $familySiteWrap.find('button');
            var $familySiteList = $familySiteWrap.find('.ui_dropdown_list li');
            $familySiteBtn.on('click', function () {
                $familySiteWrap.toggleClass('open');
                if($familySiteWrap.hasClass('open')){
                    $familySiteWrap.attr('aria-expanded', 'true');
                } else {
                    $familySiteWrap.attr('aria-expanded', 'false');
                    $familySiteList.removeClass('on');
                }
            });
            $familySiteList.on('click', function(){
                $(this).addClass('on').siblings().removeClass('on');
            });

            initMoGnbHeader($header, $familySiteWrap);
        });

        MoGnbUI.bindDocumentEvents();
    }

    // =========================================================================
    // Toolbar — 모바일 하단 독바
    // =========================================================================

    function initToolbar() {
        if (toolbarBound) return;
        toolbarBound = true;

        $('.mobile-status-bar .mobile-status-list > li a').each(function () {
            var $link = $(this);
            var $span = $link.find('span').first();
            var label = $.trim($span.text());

            if (label && !$link.attr('aria-label')) {
                $link.attr('aria-label', label);
            }

            if ($span.length) {
                $span.attr('aria-hidden', 'true');
            }
        });

        var toolbarList = '.mobile-status-bar .mobile-status-list > li:not(.lge):not(.menu)';
        $(document).on('click' + TOOLBAR_NS, toolbarList + ' a', function (e) {
            e.preventDefault();
            $(toolbarList).removeClass('active');
            $(this).closest('li').toggleClass('active');
        });

        // iOS VoiceOver: 독바 항목 간 이동 시 페이지가 맨 아래로 스크롤됨
        // (scrollY 복원 싸움은 오히려 흔들림이 커져, 포커스가 독바에 있는 동안만 스크롤 잠금)
        bindToolbarIosScrollLock();
    }

    function isToolbarIosDevice() {
        return isIOS();
    }

    /**
     * iOS VoiceOver 전용 — 독바 포커스 유지 중 document 스크롤 잠금
     * 원인: fixed 독바가 DOM상 wrap 끝이라, 항목 간 포커스 시 Safari 가 문서 하단으로 scroll-into-view
     * 대응: body position:fixed 로 스크롤 자체를 막고, 독바를 벗어나면 원래 scrollY 복원
     */
    function bindToolbarIosScrollLock() {
        if (!isToolbarIosDevice()) return;

        var locked = false;
        var lockedY = 0;

        function getScrollY() {
            return window.pageYOffset
                || document.documentElement.scrollTop
                || document.body.scrollTop
                || 0;
        }

        function isInToolbar(el) {
            return !!(el && el.closest && el.closest('.mobile-status-bar'));
        }

        function lockScroll() {
            if (locked) return;
            locked = true;
            lockedY = getScrollY();
            document.body.style.position = 'fixed';
            document.body.style.top = '-' + lockedY + 'px';
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.width = '100%';
        }

        function unlockScroll() {
            if (!locked) return;
            locked = false;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.width = '';
            window.scrollTo(0, lockedY);
        }

        document.addEventListener('focusin', function (e) {
            if (moGnb.skipToolbarLock) {
                moGnb.skipToolbarLock = false;
                return;
            }
            if (isInToolbar(e.target)) {
                lockScroll();
            } else {
                unlockScroll();
            }
        }, true);

        document.addEventListener('focusout', function (e) {
            if (!locked) return;
            // 독바 내부 항목 간 이동은 relatedTarget 이 같은 바 안일 수 있음 → 유지
            if (isInToolbar(e.relatedTarget)) return;

            setTimeout(function () {
                if (!isInToolbar(document.activeElement)) {
                    unlockScroll();
                }
            }, 0);
        }, true);
    }

    /** @namespace Toolbar — 모바일 하단 독바 */
    var Toolbar = {
        init: initToolbar
    };

    // =========================================================================
    // UI — 하단 고정 버튼 sticky (.bottom-fix)
    // .bottom-fix 바로 위 1px probe 가 (뷰포트 - 버튼높이 - bottom) 영역에서
    // 위쪽으로 사라지면 is-sticky
    // =========================================================================

    function bottomFixButton() {
        var stickyEl = document.querySelector('.bottom-fix');
        if (!stickyEl || stickyEl.getAttribute('data-bottom-fix-init') === 'true') return;
        if (!stickyEl.querySelector('.btn-group')) {
            stickyEl.classList.add('is-not-sticky');
            return;
        }
        if (!stickyEl.parentNode || !('IntersectionObserver' in window)) return;

        stickyEl.setAttribute('data-bottom-fix-init', 'true');

        var probe = document.createElement('div');
        probe.className = 'bottom-fix-probe';
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'width:100%;height:1px;margin:0 0 -1px;padding:0;overflow:hidden;visibility:hidden;pointer-events:none;';
        stickyEl.parentNode.insertBefore(probe, stickyEl);

        var observer = null;

        function getRootMargin() {
            var style = window.getComputedStyle(stickyEl);
            var stickyBottom = parseInt(style.bottom, 10) || 0;
            var wasSticky = stickyEl.classList.contains('is-sticky');
            if (wasSticky) stickyEl.classList.remove('is-sticky');
            var barH = stickyEl.offsetHeight || 0;
            if (wasSticky) stickyEl.classList.add('is-sticky');
            var inset = stickyBottom + barH;
            return inset > 0 ? ('0px 0px -' + inset + 'px 0px') : '0px';
        }

        function onProbe(entries) {
            var entry = entries[0];
            if (!entry) return;
            // 관찰 영역(버튼·탭바 제외) 밖 = CSS sticky
            stickyEl.classList.toggle('is-sticky', !entry.isIntersecting);
        }

        function bindObserver() {
            if (observer) observer.disconnect();
            observer = new IntersectionObserver(onProbe, {
                threshold: 0,
                rootMargin: getRootMargin()
            });
            observer.observe(probe);
        }

        bindObserver();
        window.addEventListener('resize', bindObserver, { passive: true });
    }

    // =========================================================================
    // SwiperA11y — swiper-wrapper aria-live 제거 · 슬라이드 포커스 제어
    // =========================================================================

    function removeSwiperWrapperAriaLive(scope) {
        var root = scope && scope.querySelectorAll ? scope : document;

        if (!root.querySelectorAll) return;

        root.querySelectorAll('.swiper-wrapper[aria-live]').forEach(function (wrapper) {
            wrapper.removeAttribute('aria-live');
        });
    }

    function initSwiperWrapperAriaLiveDisable() {
        if (!window.Swiper || typeof Swiper.extendDefaults !== 'function') return;

        // Swiper 12.2: watchSlidesProgress → .swiper-slide-visible / .swiper-slide-fully-visible
        Swiper.extendDefaults({
            watchSlidesProgress: true,
            a11y: {
                wrapperLiveRegion: false
            }
        });
    }

    function observeSwiperWrapperAriaLive() {
        if (!window.MutationObserver || swiperAriaLiveObserver) return;

        removeSwiperWrapperAriaLive();

        swiperAriaLiveObserver = new MutationObserver(function (mutations) {
            if (domSyncing) return;

            mutations.forEach(function (mutation) {
                if (mutation.type !== 'attributes' || mutation.attributeName !== 'aria-live') return;
                if (!mutation.oldValue) return;

                var target = mutation.target;
                if (!target || !target.classList || !target.classList.contains('swiper-wrapper')) return;
                if (!target.hasAttribute('aria-live')) return;

                target.removeAttribute('aria-live');
            });
        });

        swiperAriaLiveObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ['aria-live'],
            attributeOldValue: true,
            subtree: true
        });
    }

    initSwiperWrapperAriaLiveDisable();

    // --- Swiper 포커스 (a 탭 격리 + focusin 시 transform 리셋 방지) ---
    // Swiper 12: watchSlidesProgress → .swiper-slide-fully-visible / .swiper-slide-visible
    // slidesPerView > 1 이면 active 1장만 허용하면 안 됨 → 온전히 보이는 슬라이드 전부 포커스

    /** Dom7 / Array / NodeList → 일반 배열 (Swiper 5~12 호환) */
    function getSwiperSlideElements(swiper) {
        if (!swiper || !swiper.slides) return [];
        var slides = swiper.slides;
        if (Array.isArray(slides)) return slides;
        if (typeof slides.toArray === 'function') return slides.toArray();
        return Array.prototype.slice.call(slides);
    }

    function isHeroBannerSwiper(swiper) {
        return !!(swiper.el && swiper.el.classList && swiper.el.classList.contains('main-swiper'));
    }

    function getHeroBannerActiveSlides(swiper) {
        var slides = getSwiperSlideElements(swiper);
        var activeSlides = slides.filter(function (slide) {
            return slide.classList.contains('swiper-slide-active')
                && !slide.classList.contains('swiper-slide-duplicate');
        });
        if (activeSlides.length) return activeSlides;

        activeSlides = slides.filter(function (slide) {
            return slide.classList.contains('swiper-slide-active');
        });
        if (activeSlides.length) return [activeSlides[0]];

        return slides[swiper.activeIndex] ? [slides[swiper.activeIndex]] : [];
    }

    function getHeroBannerSlideLink(slide) {
        if (!slide) return null;
        return slide.querySelector(':scope > a[href]') || slide.querySelector('a.item[href]');
    }

    function isHeroBannerFocusTarget(el, activeSlide) {
        if (!activeSlide) return false;

        var activeLink = getHeroBannerSlideLink(activeSlide);
        if (activeLink && (el === activeLink || activeLink.contains(el))) {
            return true;
        }

        var videoBtnWrap = activeSlide.querySelector(':scope > .hero-videoBtn-wrap');
        return !!(videoBtnWrap && (el === videoBtnWrap || videoBtnWrap.contains(el)));
    }

    function setSwiperFocusDisabled(el) {
        if (!el.hasAttribute('data-swiper-tabindex')) {
            el.setAttribute('data-swiper-tabindex', el.hasAttribute('tabindex') ? el.getAttribute('tabindex') : '');
        }
        el.setAttribute('tabindex', '-1');
    }

    function restoreSwiperFocusEnabled(el) {
        if (el.hasAttribute('data-swiper-tabindex')) {
            var originalTabindex = el.getAttribute('data-swiper-tabindex');
            if (originalTabindex === '') {
                el.removeAttribute('tabindex');
            } else {
                el.setAttribute('tabindex', originalTabindex);
            }
            el.removeAttribute('data-swiper-tabindex');
        } else if (el.getAttribute('tabindex') === '-1') {
            el.removeAttribute('tabindex');
        }
    }

    /**
     * 슬라이드 단위 접근성 숨김 (VoiceOver/TalkBack 대응)
     * ※ inert 는 쓰면 안 됨 — 포커스뿐 아니라 터치/스와이프까지 막힘
     */
    function setSwiperSlideAccessibility(slide, isVisible) {
        if (isVisible) {
            if (slide.getAttribute('data-swiper-a11y-hidden') === 'true') {
                slide.removeAttribute('aria-hidden');
                slide.removeAttribute('data-swiper-a11y-hidden');
            }
            if ('inert' in slide && slide.inert) {
                slide.inert = false;
            }
            return;
        }

        if (slide.getAttribute('data-swiper-a11y-hidden') !== 'true') {
            slide.setAttribute('data-swiper-a11y-hidden', 'true');
        }
        slide.setAttribute('aria-hidden', 'true');
        // inert 제거: 부분 노출 슬라이드를 드래그해 넘기는 제스처가 막힘
        if ('inert' in slide && slide.inert) {
            slide.inert = false;
        }
    }

    /**
     * 슬라이드가 스와이퍼 뷰포트에 온전히 보이는지
     * - .swiper-slide-fully-visible OR 좌표 판정 (OR)
     * ※ 클래스만 믿으면 breakpoint(4→3) 시 반올림으로 마지막 장이 빠져 tabindex=-1 됨
     */
    function isSlideFullyVisibleInSwiper(swiper, slide) {
        if (!swiper || !slide) return false;

        if (slide.classList.contains('swiper-slide-fully-visible')) {
            return true;
        }

        return isSlideFullyVisibleByRect(swiper, slide);
    }

    /** getBoundingClientRect 기준 완전 노출 (반응형 서브픽셀 여유 포함) */
    function isSlideFullyVisibleByRect(swiper, slide) {
        if (!swiper || !swiper.el || !slide) return false;

        // overflow 영역 기준: .swiper 대신 size 계산에 쓰는 wrapper 부모
        var viewport = swiper.el;
        var containerRect = viewport.getBoundingClientRect();
        var slideRect = slide.getBoundingClientRect();

        // spaceBetween/breakpoint 반올림으로 마지막 장이 1~수 px 넘치는 경우 허용
        var tolerance = 8;

        if (slideRect.width <= 0 || slideRect.height <= 0) return false;

        var isHorizontal = !swiper.params || swiper.params.direction !== 'vertical';

        if (isHorizontal) {
            return slideRect.left >= containerRect.left - tolerance
                && slideRect.right <= containerRect.right + tolerance;
        }

        return slideRect.top >= containerRect.top - tolerance
            && slideRect.bottom <= containerRect.bottom + tolerance;
    }

    function getVisibleSwiperSlides(swiper) {
        if (!swiper) return [];

        if (isHeroBannerSwiper(swiper)) {
            return getHeroBannerActiveSlides(swiper);
        }

        var slides = getSwiperSlideElements(swiper);
        if (!slides.length) return [];

        var fullyVisibleSlides = slides.filter(function (slide) {
            return isSlideFullyVisibleInSwiper(swiper, slide);
        });

        if (!(swiper.params && swiper.params.loop)) {
            return fullyVisibleSlides;
        }

        // loop: 화면에 온전히 보이는 쪽 유지 (원본만 남기면 duplicate 가 -1 되어 개수 감소)
        var byIndex = {};
        var order = [];

        fullyVisibleSlides.forEach(function (slide) {
            var idx = slide.getAttribute('data-swiper-slide-index');
            var key = idx != null ? String(idx) : 'node-' + order.length;
            var isDup = slide.classList.contains('swiper-slide-duplicate');

            if (!byIndex.hasOwnProperty(key)) {
                byIndex[key] = slide;
                order.push(key);
                return;
            }

            if (!isDup && byIndex[key].classList.contains('swiper-slide-duplicate')) {
                byIndex[key] = slide;
            }
        });

        return order.map(function (key) {
            return byIndex[key];
        });
    }

    /**
     * [기능 1] 화면 밖 슬라이드 포커스 격리
     * - 온전히 보이는 슬라이드의 a/버튼 등만 탭 가능
     * - 나머지 tabindex=-1 (+ 슬라이드 aria-hidden)
     * ※ slidesPerView>1 이라 active 1장만 허용하면 라이브/매니저가 깨짐
     */
    function cleanUpTabFocus(swiper) {
        var slides = getSwiperSlideElements(swiper);
        if (!slides.length) return;

        var focusableSelectors = 'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, [contenteditable], [tabindex]:not([tabindex="-1"])';
        var isHero = isHeroBannerSwiper(swiper);
        var visibleSlides = isHero ? getHeroBannerActiveSlides(swiper) : getVisibleSwiperSlides(swiper);
        var activeSlide = isHero ? visibleSlides[0] : null;
        var visibleSet = new Set(visibleSlides);

        slides.forEach(function (slide) {
            var isVisible = visibleSet.has(slide);

            setSwiperSlideAccessibility(slide, isVisible);

            slide.querySelectorAll(focusableSelectors).forEach(function (el) {
                if (isHero) {
                    if (isHeroBannerFocusTarget(el, activeSlide)) {
                        restoreSwiperFocusEnabled(el);
                    } else {
                        setSwiperFocusDisabled(el);
                    }
                    return;
                }

                if (isVisible) {
                    restoreSwiperFocusEnabled(el);
                } else {
                    setSwiperFocusDisabled(el);
                }
            });

            if (!isVisible) {
                slide.querySelectorAll('a[href]').forEach(function (anchor) {
                    setSwiperFocusDisabled(anchor);
                });
            }
        });
    }

    function resetSwiperContainerScroll(swiper) {
        if (!swiper) return;

        var el = swiper.el;
        var wrapper = swiper.wrapperEl
            || (el && el.querySelector && el.querySelector('.swiper-wrapper'));

        if (el) {
            if (el.scrollLeft) el.scrollLeft = 0;
            if (el.scrollTop) el.scrollTop = 0;
        }
        if (wrapper) {
            if (wrapper.scrollLeft) wrapper.scrollLeft = 0;
            if (wrapper.scrollTop) wrapper.scrollTop = 0;
        }
    }

    function restoreSwiperTranslate(swiper, translate) {
        if (!swiper || typeof translate !== 'number' || isNaN(translate)) return;
        if (typeof swiper.setTranslate !== 'function') return;

        swiper.setTranslate(translate);
        if (typeof swiper.updateProgress === 'function') {
            swiper.updateProgress(translate);
        }
    }

    /**
     * [기능 2] Tab 포커스 시 브라우저 scroll-into-view 로 transform 이 맨 앞으로 리셋되는 것 방지
     * - 이미 화면에 온전히 보이는 슬라이드면 slideTo 하지 않음 (다중 노출 캐러셀 점프 방지)
     * - 화면 밖 슬라이드에 포커스가 들어온 경우에만 slideTo(index, 0) 로 동기화 (Swiper 12)
     */
    function initFocusSync(swiper) {
        if (!swiper || !swiper.el) return;
        if (swiper.el.getAttribute('data-swiper-focus-sync') === '1') return;

        swiper.el.setAttribute('data-swiper-focus-sync', '1');

        var savedTranslate = null;

        swiper.el.addEventListener('keydown', function (e) {
            if (e.key !== 'Tab' && e.keyCode !== 9) return;
            savedTranslate = typeof swiper.getTranslate === 'function'
                ? swiper.getTranslate()
                : swiper.translate;
        }, true);

        swiper.el.addEventListener('focusin', function (e) {
            var target = e.target;
            if (!target || typeof target.closest !== 'function') return;

            var targetSlide = target.closest('.swiper-slide');
            if (!targetSlide || !swiper.el.contains(targetSlide)) return;

            var translate = savedTranslate;
            if (typeof translate !== 'number' || isNaN(translate)) {
                translate = typeof swiper.getTranslate === 'function'
                    ? swiper.getTranslate()
                    : swiper.translate;
            }
            savedTranslate = null;

            function lockPosition() {
                resetSwiperContainerScroll(swiper);
                restoreSwiperTranslate(swiper, translate);
            }

            // 온전히 보이는 슬라이드면 좌표만 고정 (slideTo 로 점프하지 않음)
            if (isSlideFullyVisibleInSwiper(swiper, targetSlide)) {
                lockPosition();
                window.requestAnimationFrame(lockPosition);
                return;
            }

            // 화면 밖이면 Swiper 12 slides[] 인덱스로 즉시 맞춤 (runCallbacks=false)
            var slides = getSwiperSlideElements(swiper);
            var slideIndex = slides.indexOf(targetSlide);
            if (slideIndex < 0) {
                lockPosition();
                return;
            }

            if (typeof swiper.slideTo === 'function') {
                swiper.slideTo(slideIndex, 0, false);
            }

            window.requestAnimationFrame(function () {
                resetSwiperContainerScroll(swiper);
                cleanUpTabFocus(swiper);
            });
        }, true);
    }

    /**
     * 레이아웃/breakpoint 반영 후 cleanUp (resize 직후 좌표·클래스가 한 프레임 늦게 갱신됨)
     */
    function scheduleCleanUpTabFocus(swiper) {
        if (!swiper) return;

        if (swiper.__bestFocusCleanUpRaf) {
            window.cancelAnimationFrame(swiper.__bestFocusCleanUpRaf);
            swiper.__bestFocusCleanUpRaf = null;
        }

        swiper.__bestFocusCleanUpRaf = window.requestAnimationFrame(function () {
            swiper.__bestFocusCleanUpRaf = window.requestAnimationFrame(function () {
                swiper.__bestFocusCleanUpRaf = null;
                if (typeof swiper.updateSlidesClasses === 'function') {
                    try { swiper.updateSlidesClasses(); } catch (err) { /* noop */ }
                }
                cleanUpTabFocus(swiper);
            });
        });
    }

    /** slideChange 등에서도 cleanUp 이 돌도록 1회 바인딩 (HTML on 과 중복이어도 안전) */
    function bindSwiperFocusLifecycle(swiper) {
        if (!swiper || typeof swiper.on !== 'function') return;
        if (swiper.__bestFocusLifecycleBound) return;
        swiper.__bestFocusLifecycleBound = true;

        swiper.on('slideChange', function () {
            cleanUpTabFocus(swiper);
        });
        swiper.on('slideChangeTransitionEnd', function () {
            cleanUpTabFocus(swiper);
        });
        // resize / breakpoint: 레이아웃 안정 후 재계산 (4뷰→3뷰 마지막 장 -1 방지)
        swiper.on('resize', function () {
            scheduleCleanUpTabFocus(swiper);
        });
        swiper.on('breakpoint', function () {
            scheduleCleanUpTabFocus(swiper);
        });
    }

    /**
     * 기존 페이지 on.init / slideChangeTransitionEnd / resize 에서 호출
     * (= Gemini: init → cleanUpTabFocus + initFocusSync / slideChange → cleanUpTabFocus)
     */
    function handleUniversalSwiperFocus(swiper) {
        if (!swiper) return;

        var slides = getSwiperSlideElements(swiper);
        if (!slides.length) return;

        if (swiper.el) {
            removeSwiperWrapperAriaLive(swiper.el);
        }

        // 인스턴스에 watchSlidesProgress 가 꺼져 있으면 켠다 (Swiper 12 가시성 클래스)
        if (swiper.params && swiper.params.watchSlidesProgress !== true) {
            swiper.params.watchSlidesProgress = true;
            if (swiper.originalParams) {
                swiper.originalParams.watchSlidesProgress = true;
            }
            if (typeof swiper.updateSlidesClasses === 'function') {
                try { swiper.updateSlidesClasses(); } catch (err) { /* noop */ }
            } else if (typeof swiper.update === 'function') {
                try { swiper.update(); } catch (err2) { /* noop */ }
            }
        }

        initFocusSync(swiper);
        bindSwiperFocusLifecycle(swiper);
        cleanUpTabFocus(swiper);
    }

    /**
     * @namespace SwiperA11y
     * Swiper 접근성 공개 API (aria-live 제거 · 슬라이드 포커스 제어)
     */
    var SwiperA11y = {
        removeWrapperAriaLive: removeSwiperWrapperAriaLive,
        observeAriaLive: observeSwiperWrapperAriaLive,
        handleFocus: handleUniversalSwiperFocus,
        cleanUpTabFocus: cleanUpTabFocus,
        initFocusSync: initFocusSync
    };

    // -------------------------------------------------------------------------
    // 유틸 — 쿠키
    // -------------------------------------------------------------------------

    function setCookie(cookieName, value, exdays) {
        var exdate = new Date();
        exdate.setDate(exdate.getDate() + exdays);
        var cookieValue = escape(value) + ((exdays == null) ? "" : "; expires=" + exdate.toGMTString());
        document.cookie = cookieName + "=" + cookieValue;
    }

    function getCookie(cookieName) {
        cookieName = cookieName + '=';
        var cookieData = document.cookie;
        var start = cookieData.indexOf(cookieName);
        var cookieValue = '';
        if (start != -1) {
            start += cookieName.length;
            var end = cookieData.indexOf(';', start);
            if (end == -1) end = cookieData.length;
            cookieValue = cookieData.substring(start, end);
        }
        return unescape(cookieValue);
    }

    // -------------------------------------------------------------------------
    // 모바일 바텀 시트
    // -------------------------------------------------------------------------

    function bindBottomSheet(sheet) {
        var sheetHandle = sheet.querySelector('.btn-layer-control');
        if (!sheetHandle) return;

        var targetSel = sheet.getAttribute('data-target');
        var hasTargetAttr = targetSel !== null && String(targetSel).trim() !== '';
        var targetEl = hasTargetAttr ? document.querySelector(String(targetSel).trim()) : null;
        if (hasTargetAttr && !targetEl) return;

        var minAttr = sheet.getAttribute('data-min-height');
        var hasMinAttr = minAttr !== null && String(minAttr).trim() !== '';
        var minH = hasMinAttr ? parseFloat(minAttr) : 0;
        if (isNaN(minH)) minH = 0;

        var toolbar = document.querySelector('.mobile-status-bar');
        var pageFooter = document.querySelector('footer.footer, .footer');

        var sheetDragging = false;
        var sheetPointerId = null;
        var sheetStartY = 0;
        var sheetStartHeight = 0;
        var gesturePointerDownY = 0;
        var gestureStartHeight = 0;
        var gestureStartTime = 0;
        var lastMoveClientY = 0;
        var lastMoveTime = 0;
        var lockedScrollY = 0;
        var scrollLocked = false;

        var POINTER_SLOP_PX = 14;
        var FLING_VELOCITY_PX_PER_MS = 0.35;
        var SNAP_MID_RATIO = 0.5;

        var getSheetViewportHeight = function () {
            var vv = window.visualViewport;
            return vv && typeof vv.height === 'number' ? vv.height : window.innerHeight;
        };

        var parseResolvedMaxHeightPx = function (el) {
            var v = window.getComputedStyle(el).maxHeight;
            if (!v || v === 'none') return null;
            var n = parseFloat(v);
            if (isNaN(n)) return null;
            return /px/i.test(v) ? n : null;
        };

        /** 시트 하단 inset — CSS bottom · toolbar · 푸터 가시 영역을 반영 */
        var getSheetBottomEdge = function () {
            var sheetRect = sheet.getBoundingClientRect();
            var vh = getSheetViewportHeight();
            var bottomEdge = sheetRect.bottom;

            // absolute 시트가 스크롤로 밀려도, 실제 하단을 기준으로 계산
            if (!isFinite(bottomEdge) || bottomEdge <= 0) {
                var cssBottom = parseFloat(window.getComputedStyle(sheet).bottom);
                var toolbarHeight = toolbar && toolbar.offsetParent !== null ? toolbar.offsetHeight : 0;
                var inset = !isNaN(cssBottom) ? cssBottom : toolbarHeight;
                bottomEdge = vh - Math.max(0, inset);
            }

            // 뷰포트에 보이는 페이지 푸터가 시트보다 위에 있으면 그 상단까지로 제한
            if (pageFooter) {
                var fr = pageFooter.getBoundingClientRect();
                if (fr.top < bottomEdge && fr.bottom > 0 && fr.top > 0) {
                    bottomEdge = Math.min(bottomEdge, fr.top);
                }
            }

            return bottomEdge;
        };

        var getSheetMaxHeight = function () {
            var sheetBottom = getSheetBottomEdge();
            var cssMax = parseResolvedMaxHeightPx(sheet);

            if (targetEl) {
                var targetBottom = targetEl.getBoundingClientRect().bottom;
                var maxByTarget = Math.floor(sheetBottom - targetBottom);
                if (cssMax !== null) maxByTarget = Math.min(maxByTarget, cssMax);
                return Math.max(minH, maxByTarget);
            }

            if (cssMax !== null) return Math.max(minH, cssMax);

            return Math.max(minH, Math.floor(sheetBottom));
        };

        var lockPageScroll = function () {
            if (scrollLocked) return;
            scrollLocked = true;
            lockedScrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
            document.body.style.position = 'fixed';
            document.body.style.top = '-' + lockedScrollY + 'px';
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.width = '100%';
        };

        var unlockPageScroll = function () {
            if (!scrollLocked) return;
            scrollLocked = false;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.width = '';
            window.scrollTo(0, lockedScrollY);
        };

        if (sheetHandle.style.touchAction !== 'none') {
            sheetHandle.style.touchAction = 'none';
        }

        if (!sheetHandle.getAttribute('aria-expanded')) {
            sheetHandle.setAttribute('aria-expanded', sheet.classList.contains('active') ? 'true' : 'false');
        }
        if (!sheetHandle.getAttribute('aria-label') && !sheetHandle.textContent.trim()) {
            sheetHandle.setAttribute('aria-label', '시트 높이 조절');
        }

        /**
         * .search-result-wrap.btn-layer-control
         * - MO: role=button + tabindex=0 (키보드·스크린리더로 시트 조절)
         * - PC: role/tabindex 제거 (버튼이 아님)
         */
        var syncSearchResultHandleA11y = function () {
            if (!sheetHandle.classList.contains('search-result-wrap')) return;
            var isMo = (typeof _thsW === 'number' ? _thsW : window.innerWidth) <= 767;
            if (isMo) {
                sheetHandle.setAttribute('role', 'button');
                sheetHandle.setAttribute('tabindex', '0');
            } else {
                sheetHandle.removeAttribute('role');
                sheetHandle.removeAttribute('tabindex');
            }
        };
        syncSearchResultHandleA11y();
        sheetHandle._syncSearchResultHandleA11y = syncSearchResultHandleA11y;

        var onSheetPointerDown = function (e) {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            sheetDragging = true;
            sheetPointerId = e.pointerId;
            try { sheetHandle.setPointerCapture(e.pointerId); } catch (err) {}
            lockPageScroll();
            sheetStartY = e.clientY;
            sheetStartHeight = sheet.offsetHeight;
            gesturePointerDownY = e.clientY;
            gestureStartHeight = sheet.offsetHeight;
            gestureStartTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            lastMoveClientY = e.clientY;
            lastMoveTime = gestureStartTime;
            sheet.style.transition = 'none';
        };

        var onSheetPointerMove = function (e) {
            if (!sheetDragging || e.pointerId !== sheetPointerId) return;
            if (e.cancelable) e.preventDefault();

            var now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            lastMoveClientY = e.clientY;
            lastMoveTime = now;

            var deltaY = sheetStartY - e.clientY;
            var newHeight = sheetStartHeight + deltaY;
            var maxH = getSheetMaxHeight();

            if (newHeight > maxH) newHeight = maxH;
            if (newHeight < minH) newHeight = minH;

            sheet.style.height = newHeight + 'px';
        };

        var resetSheetListScroll = function () {
            var listWrap = sheet.querySelector('.search-list-wrap, .store-list-wrap');
            if (!listWrap) return;

            // mCustomScrollbar(PC) / 네이티브 스크롤(MO) 모두 대응
            var $listWrap = window.jQuery ? window.jQuery(listWrap) : null;
            if ($listWrap && $listWrap.data('mCS') && typeof $listWrap.mCustomScrollbar === 'function') {
                $listWrap.mCustomScrollbar('scrollTo', 0, { scrollInertia: 0 });
            } else {
                listWrap.scrollTop = 0;
                if (typeof listWrap.scrollTo === 'function') listWrap.scrollTo(0, 0);
            }

            var listUl = listWrap.querySelector('ul');
            if (listUl) {
                listUl.scrollTop = 0;
                if (typeof listUl.scrollTo === 'function') listUl.scrollTo(0, 0);
            }
        };

        var onSheetPointerUp = function (e) {
            if (!sheetDragging || e.pointerId !== sheetPointerId) return;
            sheetDragging = false;
            sheetPointerId = null;
            try { sheetHandle.releasePointerCapture(e.pointerId); } catch (err) {}
            unlockPageScroll();

            sheet.style.transition = 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';

            var maxH = getSheetMaxHeight();
            var h = sheet.offsetHeight;
            var span = Math.max(0, maxH - minH);

            var snapToMinAndCleanup = function () {
                sheet.style.height = minH + 'px';
                sheet.removeAttribute('style');
                sheet.classList.remove('active');
                resetSheetListScroll();
            };

            var setSheetExpanded = function (expanded) {
                sheetHandle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            };

            var openSheet = function () {
                sheet.style.height = maxH + 'px';
                sheet.classList.add('active');
                setSheetExpanded(true);
            };

            var closeSheet = function () {
                snapToMinAndCleanup();
                setSheetExpanded(false);
            };

            // 클릭(탭): 드래그 없이 핸들 영역 누르면 열기/닫기 토글
            var totalMove = Math.abs(e.clientY - gesturePointerDownY);
            if (totalMove < POINTER_SLOP_PX) {
                if (sheet.classList.contains('active')) {
                    closeSheet();
                } else {
                    openSheet();
                }
                return;
            }

            var tNow = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            var dtGesture = Math.max(1, tNow - gestureStartTime);
            var avgVy = (e.clientY - gesturePointerDownY) / dtGesture;
            var dtLast = Math.max(1, tNow - lastMoveTime);
            var instantVy = (e.clientY - lastMoveClientY) / dtLast;
            var vy = Math.abs(instantVy) > Math.abs(avgVy) ? instantVy : avgVy;

            if (vy < -FLING_VELOCITY_PX_PER_MS) {
                openSheet();
                return;
            }
            if (vy > FLING_VELOCITY_PX_PER_MS) {
                closeSheet();
                return;
            }

            // 중간 고정 제거 — 50% 이상이면 열림, 미만이면 닫힘 (동률은 드래그 방향)
            var ratio = span > 0 ? (h - minH) / span : 0;
            var dragDeltaY = e.clientY - gesturePointerDownY;
            if (ratio > SNAP_MID_RATIO) {
                openSheet();
            } else if (ratio < SNAP_MID_RATIO) {
                closeSheet();
            } else if (dragDeltaY < 0) {
                openSheet();
            } else {
                closeSheet();
            }
        };

        var onSheetHandleKeyDown = function (e) {
            var key = e.key || e.keyCode;
            // PC 에서는 핸들이 버튼이 아니므로 키보드 토글 비활성
            if ((typeof _thsW === 'number' ? _thsW : window.innerWidth) > 767) return;
            if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && key !== 13 && key !== 32) return;

            e.preventDefault();

            sheet.style.transition = 'height 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)';

            if (sheet.classList.contains('active')) {
                sheet.style.height = minH + 'px';
                sheet.removeAttribute('style');
                sheet.classList.remove('active');
                sheetHandle.setAttribute('aria-expanded', 'false');
                resetSheetListScroll();
            } else {
                sheet.style.height = getSheetMaxHeight() + 'px';
                sheet.classList.add('active');
                sheetHandle.setAttribute('aria-expanded', 'true');
            }
        };

        // tabindex/role 은 syncSearchResultHandleA11y (MO만) 에서 처리
        sheetHandle.addEventListener('pointerdown', onSheetPointerDown);
        sheetHandle.addEventListener('pointermove', onSheetPointerMove, { passive: false });
        sheetHandle.addEventListener('pointerup', onSheetPointerUp);
        sheetHandle.addEventListener('pointercancel', onSheetPointerUp);
        sheetHandle.addEventListener('keydown', onSheetHandleKeyDown);

        // data-target 높이 변화(칩 append/remove) 시 열린 시트를 타겟 하단에 다시 맞춤
        if (targetEl && window.ResizeObserver) {
            var targetResizeRaf = 0;
            var onTargetResize = function () {
                if (targetResizeRaf) return;
                targetResizeRaf = requestAnimationFrame(function () {
                    targetResizeRaf = 0;
                    if (!sheet.classList.contains('active')) return;
                    sheet.style.height = getSheetMaxHeight() + 'px';
                });
            };
            new ResizeObserver(onTargetResize).observe(targetEl);
        }
    }

    // =========================================================================
    // DelegatedEvents — document 위임 이벤트 (페이지당 1회)
    // sltBox / calendar / tab / chip / 매장찾기 MO 탭 / floating top 등
    // =========================================================================

    function bindDelegatedEvents() {
        if (delegatedEventsBound) return;
        delegatedEventsBound = true;

        // sltBox
        $(document).on('click', '.sltBox a', function () {
            var slt = $(this).parents('.sltBox');

            if (slt.hasClass('disabled')) {
                return false;
            }

            if ($(this).is('.btn-slt')) {
                $('.sltBox').not(slt).removeClass('on').find('.btn-slt').attr('aria-expanded', 'false');
                slt.toggleClass('on');
                $(this).attr('aria-expanded', slt.hasClass('on') ? 'true' : 'false');
            } else if (slt.attr('data-txt-change') === 'true') {
                var index = $(this).parent().index();
                var txt = $(this).text();
                var sel = slt.find('select');
                var indexDefault = slt.attr('data-default-selected');
                var $btn = slt.find('.btn-slt');

                $(this).parents('li').addClass('active').siblings('li').removeClass('active')
                    .find('a').removeAttr('title');
                $(this).attr('title', '선택됨');

                $btn.text(txt).attr('aria-expanded', 'false');
                slt.removeClass('on');
                sel.find('option').attr('selected', false);
                sel.find('option').eq(index).attr('selected', true).trigger('change');
                $btn.focus();

                if (index != indexDefault) {
                    slt.addClass('change');
                } else {
                    slt.removeClass('change');
                }
            }
        });

        $(document).on('change', '.sltBox select', function () {
            var $select = $(this);
            var slt = $select.parents('.sltBox');
            var $selected = $select.find('option:selected');
            var txt = $selected.text();
            var index = $selected.index();
            var indexDefault = slt.attr('data-default-selected');

            // 선택값 변경 시 option selected 속성 동기화
            $select.find('option').attr('selected', false);
            $select.find('option').eq(index).attr('selected', true);

            slt.find('.btn-slt').text(txt);
            slt.find('li').eq(index).addClass('active').siblings().removeClass('active')
                .find('a').removeAttr('title');
            slt.find('li').eq(index).find('a').attr('title', '선택됨');

            if (index != indexDefault) {
                slt.addClass('change');
            } else {
                slt.removeClass('change');
            }
        });

        $(document).on('click', function (e) {
            if (!$(e.target).closest('.sltBox').length) {
                $('.sltBox').removeClass('on').find('.btn-slt').attr('aria-expanded', 'false');
            }
        });

        // calendar active (모바일)
        $(document).on('click', '.date-wrap .calendar', function () {
            if ($(window).width() < 768) $(this).addClass('active');
        });

        // textfield
        $(document).on('keyup input', '.input-wrap input:not([readonly], [disabled])', function () {
            $(this).siblings('.btn-clear').toggle($(this).val().length > 0);
        });

        $(document).on('click', '.btn-clear', function () {
            var $input = $(this).parent().find('input');
            $input.val('').focus();
            updateTxtCount($(this).closest(".input-wrap").find('textarea, input'));
            $(this).hide();
        });

        $(document).on('keydown', '.btn-clear', function (e) {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                $(this).trigger('click');
            }
        });

        // textarea 글자 수
        $(document).on('keyup input', '.input-wrap textarea, .input-wrap input', function () {
            updateTxtCount($(this));
        });

        // tab
        $(document).on('click', "[class*='tab-wrap'] .tabs > li", function () {
            activateTabItem($(this));
        });

        $(document).on('keydown', "[class*='tab-wrap'] .tabs > li a", function (e) {
            var $li = $(this).parent();
            var $tabs = $li.parent().children('li');
            var idx = $tabs.index($li);
            var nextIdx = -1;

            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                nextIdx = (idx + 1) % $tabs.length;
            } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                nextIdx = (idx - 1 + $tabs.length) % $tabs.length;
            } else if (e.key === 'Home') {
                nextIdx = 0;
            } else if (e.key === 'End') {
                nextIdx = $tabs.length - 1;
            }

            if (nextIdx > -1) {
                e.preventDefault();
                var $next = $tabs.eq(nextIdx);
                activateTabItem($next);
                $next.find('a').focus();
            }
        });

        /** 탭 활성화 — UI 탭(aria-selected) / 페이지 이동형(aria-current) 분기 */
        function activateTabItem($li) {
            var $group = $li.add($li.siblings());

            $li.addClass('on').siblings().removeClass('on');

            $group.each(function () {
                var $item = $(this);
                var $a = $item.children('a').first();

                $a.removeAttr('title');

                // 실제 URL 탭 → role/aria-selected 대신 aria-current
                if (A11y.syncPageNavTabLi($item)) return;

                // UI 탭 (#none / javascript:void(0))
                if ($item.hasClass('on')) {
                    $a.attr('aria-selected', 'true');
                } else {
                    $a.attr('aria-selected', 'false');
                }
                if ($item.is('[aria-current]')) $item.removeAttr('aria-current');
                if ($a.is('[aria-current]')) $a.removeAttr('aria-current');
            });

            var $type1Wrap = $li.closest('.sub-tab-wrap.type1');
            if ($type1Wrap.length) {
                updateSubTabType1NavBg($type1Wrap);
            }

            var controls = $li.children('a').attr('aria-controls');
            if (controls) {
                $('#' + controls).addClass('active')
                    .siblings().removeClass('active')
                    .addBack()
                    .filter('[role="tabpanel"]')
                    .removeAttr('aria-select aria-selected');
            }
        }

        // chip
        $(document).on('click', '.chip-wrap .chip-item', function (e) {
            if ($(e.target).closest('.btn-delete').length) return;
            $(this).addClass('on');
            $(this).find('.chip-label').attr('aria-pressed', 'true');
        });

        $(document).on('click', '.chip-wrap .chip-item .btn-delete', function () {
            $(this).parent().removeClass('on');
            $(this).parent().find('.chip-label').attr('aria-pressed', 'false');
        });

        // 매장찾기 MO 탭
        $(document).on('click', moTabControlBtn, function (e) {
            e.preventDefault();
            if (_thsW > 767) return;

            if (isTabOpen) {
                closeStoreTabDropdown();
            } else {
                isTabOpen = true;
                $(tabWrap).show();
                $(moTabControlBtn).attr('aria-expanded', 'true');
                $(document).off('click.storeTabOutside');
                setTimeout(function () {
                    if (!isTabOpen) return;

                    $(document).on('click.storeTabOutside', function (event) {
                        if (!$(event.target).closest(tabWrap).length && !$(event.target).closest(moTabControlBtn).length) {
                            closeStoreTabDropdown();
                        }
                    });
                }, 0);
            }
        });

        $(document).on('click', tabWrap + ' .tabs > li a', function (e) {
            if (_thsW > 767) return;

            e.preventDefault();

            var text = $(this).text();
            var searchType = '';
            switch (text) {
                case '검색': searchType = '직접입력'; break;
                case '지역': searchType = '지역'; break;
                case '지하철역': searchType = '지하철역'; break;
            }

            var typeTextEl = $(moTabControlBtn).find('.search-type-text')[0];
            if (typeTextEl && typeTextEl.textContent !== searchType) {
                typeTextEl.textContent = searchType;
            }
            // 선택 후 검색 유형 버튼으로 포커스 복귀
            closeStoreTabDropdown({ restoreFocus: true });
        });

        $(document).on('click', '.floating-block .top-btn', function () {
            $(window).scrollTop(0);
            $(header).removeClass('hide');

            window.setTimeout(function () {
                focusHeaderLogo();
            }, 0);
        });

        // required (중복 append 방지)
        $(".required").not('[data-required-a11y]').each(function(){
            var $label = $(this);
            $label.attr('data-required-a11y', 'true');
            $label.append('<span class="blind">필수 입력 사항</span>');
        });

        // A11y — 선택 상태 스크린리더 안내
        A11y.bindSelectionAnnouncements();
    }

    // =========================================================================
    // MutationObserver — 비동기 DOM 추가 시 자동 init
    // (bestshop AJAX · mCustomScrollbar · datepicker 재렌더와 맞물림 방지)
    //
    // 흐름: childList 추가 → 노이즈 필터 → 루트 수집 → debounce(100ms) → initDom
    // =========================================================================

    /** mCS / datepicker / dim 등 initDom을 다시 돌릴 필요 없는 노이즈 노드 */
    function isDynamicInitNoiseNode(node) {
        if (!node || node.nodeType !== 1) return true;

        var cls = node.classList;
        if (cls) {
            if (cls.contains('mCSB_container') || cls.contains('mCSB_scrollTools') ||
                cls.contains('mCustomScrollBox') || cls.contains('mCustomScrollbar') ||
                cls.contains('ui-datepicker') || cls.contains('daterangepicker') ||
                cls.contains('dimmde') || cls.contains('dim')) {
                return true;
            }
        }

        if (node.id === 'ui-datepicker-div') return true;

        if (typeof node.closest === 'function') {
            if (node.closest('.mCSB_container, .mCSB_scrollTools, .mCustomScrollBox, .mCustomScrollbar, .ui-datepicker, #ui-datepicker-div, .daterangepicker')) {
                return true;
            }
        }

        return false;
    }

    /** 의미 있는 addedNodes의 초기화 루트 수집 (없으면 null → 전체 init) */
    function collectDynamicInitRoots(mutations) {
        var roots = [];
        var seen = [];

        mutations.forEach(function (mutation) {
            Array.prototype.forEach.call(mutation.addedNodes || [], function (node) {
                if (node.nodeType !== 1) return;
                if (isDynamicInitNoiseNode(node)) return;

                var root = node;
                if (typeof node.closest === 'function') {
                    root = node.closest(
                        '.container, .popup, .pop-wrap, .custom-scroll, .js-bestlife-panels, [class*="tab-wrap"], .store-list, .content, #content'
                    ) || node;
                }

                if (isDynamicInitNoiseNode(root) && root !== node) return;
                if (seen.indexOf(root) !== -1) return;

                seen.push(root);
                roots.push(root);
            });
        });

        return roots;
    }

    /**
     * body childList 관찰 시작 (ready 시 1회)
     * - 노이즈만 있으면 init 생략
     * - 루트 소수면 스코프 initDom($(roots)), 많으면 전체 initDom()
     */
    function observeDynamicContent() {
        if (!window.MutationObserver || dynamicContentObserver) return;

        var debounceTimer;
        dynamicContentObserver = new MutationObserver(function (mutations) {
            if (domSyncing) return;

            var roots = collectDynamicInitRoots(mutations);
            if (!roots.length) return;

            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(function () {
                if (domSyncing) return;

                // 루트가 많거나 body 직계면 전체, 아니면 스코프 init (AJAX 리스트 비용 절감)
                if (roots.length > 8 || roots.some(function (el) {
                    return el === document.body || el === document.documentElement;
                })) {
                    initDom();
                } else {
                    initDom($(roots));
                }
            }, 100);
        });

        dynamicContentObserver.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * 일반 페이지가 Popup에서 호출 되는 경우
     * - footer 영역 비활성화
     * - mobile-status-bar 비활성화
     * - bottom-fix 영역 bottom값 수정
     */
    function hiddenPopup(){
        // 팝업에서 일반 화면 호출 시 Footer 및 Mobile Status Bar Hidden 처리
        if(window.name !== ''){
            // $('footer.footer').hide();
            // $('div.mobile-status-bar').hide();
            // $('div.wrap').css('padding-bottom', '0');
            // $('div.container div.bottom-fix').css('bottom', '20px');

            // if(isApp()){
            //     $('body').addClass('lgeapp');
            // }

            if($('div.wrap').length > 0) {
                const btnClose = document.createElement('button');
                btnClose.type = 'button';
                btnClose.className = 'btn-popup-close';
                btnClose.innerHTML = '<span class="blind">닫기</span>';
                $('div.wrap').append(btnClose);
                btnClose.style.display = 'block';
                btnClose.style.zIndex = '25';

                $(document).off('click.hiddenPopup').on('click.hiddenPopup', '.btn-popup-close', function(){
                    closePopupWindow();
                });

                // $('body').addClass('hidden-layout');
            }
        }
    }

    // =========================================================================
    // 부트스트랩 (document ready · resize)
    // =========================================================================

    $(function () {
        bindDelegatedEvents();
        initTextCount();
        PopupManager.init();
        initDom();
        observeDynamicContent();
        SwiperA11y.observeAriaLive();
        hiddenPopup();

        popHeaderFixed($(window).scrollTop());
        $(window).off('scroll.bestCommonPopHeader').on('scroll.bestCommonPopHeader', function () {
            popHeaderFixed($(window).scrollTop());
        });

        headerFixed();

        // bfcache 복원 시에만 재보정 (첫 로드 pageshow 와 initDom 중복 방지)
        $(window).off('pageshow.bestCommonActiveTab').on('pageshow.bestCommonActiveTab', function (e) {
            var ev = e.originalEvent;
            if (ev && ev.persisted) {
                scheduleScrollActiveTabsIntoView(null, true);
            }
        });
    });

    $(window).off('resize.bestCommon').on('resize.bestCommon', function () {
        var newW = $(window).width();
        if (_thsW !== newW) {
            initCustomScroll();
            storeLocatorDefault();

            if (onPopArr.length) {
                PopupManager.syncLayers();
            }

            $('.sub-tab-wrap.type1[data-type1-nav-init]').each(function () {
                updateSubTabType1NavBg($(this));
            });

            scrollActiveTabsIntoView();

            _thsW = newW;

            // 바텀시트 핸들 a11y — PC/MO 전환 시 role·tabindex 재동기화
            document.querySelectorAll('.bottomSheet .search-result-wrap.btn-layer-control').forEach(function (handle) {
                if (typeof handle._syncSearchResultHandleA11y === 'function') {
                    handle._syncSearchResultHandleA11y();
                } else if (_thsW <= 767) {
                    handle.setAttribute('role', 'button');
                    handle.setAttribute('tabindex', '0');
                } else {
                    handle.removeAttribute('role');
                    handle.removeAttribute('tabindex');
                }
            });
        }
    });

    // -------------------------------------------------------------------------
    // 전역 노출 (기존 HTML/인라인·bestshop 스크립트 호환)
    // BestCommon.Modules + 레거시 window.* 별칭 (setMapZoomA11y 등)
    // -------------------------------------------------------------------------
    window.BestCommon = BestCommon;
    window.BestCommon.Modules = {
        UiInit: UiInit,
        PopupManager: PopupManager,
        A11y: A11y,
        ImageMapManager: ImageMapManager,
        MoGnbUI: MoGnbUI,
        Toolbar: Toolbar,
        SwiperA11y: SwiperA11y,
        HeaderUI: HeaderUI,
        StoreLocator: StoreLocator,
        NaverMapA11y: NaverMapA11y
    };
    window.initCustomScroll = initCustomScroll;
    window.toastNone = toastNone;
    window.setMapZoomA11y = setMapZoomA11y;
    window.focusMapInfoWindow = focusMapInfoWindow;
    window.restoreMapInfoWindowFocus = restoreMapInfoWindowFocus;
    window.bindMapInfoWindowFocus = bindMapInfoWindowFocus;
    window.bindMapMarkerKeyboard = bindMapMarkerKeyboard;
    window.NaverMapA11y = NaverMapA11y;
    window.prevScTop = prevScTop = $(window).scrollTop();
    window.resizedSearch = resizedSearch;
    window.setCookie = setCookie;
    window.getCookie = getCookie;
    window.handleUniversalSwiperFocus = handleUniversalSwiperFocus;
    window.scrollActiveTabsIntoView = scrollActiveTabsIntoView;

    Object.defineProperty(window, '_thsW', {
        get: function () { return _thsW; },
        set: function (v) { _thsW = v; },
        configurable: true
    });


}(jQuery, window, document));
