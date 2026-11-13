/* ============================================
   LA PATISSERIE MADRAS — Interactive Scripts
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ---------- Preloader ----------
    // Shown only briefly: the page is usable as soon as the HTML is in, without waiting for every photo.
    const preloader = document.getElementById('preloader');
    let revealed = false;
    function reveal() {
        if (revealed) return;
        revealed = true;
        preloader.classList.add('hidden');
        document.body.style.overflow = '';
        initScrollAnimations();
    }
    setTimeout(reveal, 350);

    // ---------- Sparkle Cursor Effect ----------
    const sparkleCanvas = document.getElementById('sparkle-canvas');
    const ctx = sparkleCanvas.getContext('2d');
    let sparkles = [];

    // Only for a mouse (not phones), only when motion is welcome, and the drawing loop sleeps
    // while there is nothing to draw.
    const sparklesOn = window.matchMedia('(hover: hover) and (pointer: fine)').matches
        && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let sparkleLoop = false;

    function resizeCanvas() {
        sparkleCanvas.width = window.innerWidth;
        sparkleCanvas.height = window.innerHeight;
    }
    if (sparklesOn) {
        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);
    } else {
        sparkleCanvas.style.display = 'none';
    }

    document.addEventListener('mousemove', (e) => {
        if (!sparklesOn) return;
        if (!sparkleLoop) {
            sparkleLoop = true;
            requestAnimationFrame(animateSparkles);
        }
        if (Math.random() > 0.55) {
            for (let i = 0; i < 2; i++) {
                sparkles.push({
                    x: e.clientX + (Math.random() - 0.5) * 20,
                    y: e.clientY + (Math.random() - 0.5) * 20,
                    size: Math.random() * 2.5 + 0.8,
                    speedX: (Math.random() - 0.5) * 1.5,
                    speedY: (Math.random() - 0.5) * 1.5 - 0.8,
                    opacity: 1,
                    color: ['#c9a96e', '#e8d5a8', '#d4a0a0', '#ffffff'][Math.floor(Math.random() * 4)],
                    rotation: Math.random() * Math.PI * 2
                });
            }
        }
    });

    function drawSparkle(s) {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.rotation);
        ctx.globalAlpha = s.opacity;
        ctx.fillStyle = s.color;
        const size = s.size;
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
            const angle = (i * Math.PI) / 2;
            ctx.lineTo(Math.cos(angle) * size, Math.sin(angle) * size);
            ctx.lineTo(Math.cos(angle + Math.PI / 4) * size * 0.3, Math.sin(angle + Math.PI / 4) * size * 0.3);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    function animateSparkles() {
        ctx.clearRect(0, 0, sparkleCanvas.width, sparkleCanvas.height);
        sparkles = sparkles.filter(s => s.opacity > 0.01);
        sparkles.forEach(s => {
            s.x += s.speedX;
            s.y += s.speedY;
            s.opacity *= 0.95;
            s.rotation += 0.04;
            s.size *= 0.98;
            drawSparkle(s);
        });
        if (sparkles.length) requestAnimationFrame(animateSparkles);
        else sparkleLoop = false;
    }

    // ---------- Navbar Scroll ----------
    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section');

    function handleNavScroll() {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        let current = '';
        sections.forEach(section => {
            const top = section.offsetTop - 120;
            if (window.scrollY >= top) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    }

    window.addEventListener('scroll', handleNavScroll, { passive: true });

    // ---------- Mobile Nav ----------
    const hamburger = document.getElementById('hamburger');
    const navLinksContainer = document.getElementById('navLinks');

    hamburger.addEventListener('click', () => {
        hamburger.classList.toggle('active');
        navLinksContainer.classList.toggle('open');
        // prevent body scroll when menu is open
        document.body.style.overflow = navLinksContainer.classList.contains('open') ? 'hidden' : '';
    });

    navLinksContainer.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navLinksContainer.classList.remove('open');
            document.body.style.overflow = '';
        });
    });

    // ---------- Smooth Scroll ----------
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

    // ---------- Scroll-Reveal Animations ----------
    function initScrollAnimations() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const delay = entry.target.dataset.delay || 0;
                    setTimeout(() => {
                        entry.target.classList.add('visible');
                    }, parseInt(delay));
                    observer.unobserve(entry.target);
                }
            });
        }, {
            threshold: 0.12,
            rootMargin: '0px 0px -40px 0px'
        });

        document.querySelectorAll('[data-animate]').forEach(el => {
            // Skip hero title/subtitle/actions — they use their own CSS keyframe entrance
            if (!el.closest('#hero')) {
                observer.observe(el);
            } else {
                // For hero elements, reveal them immediately (CSS handles animation)
                el.classList.add('visible');
            }
        });
    }

    // ---------- Hero Particles ----------
    const particlesContainer = document.getElementById('heroParticles');
    if (particlesContainer) {
        function createParticle() {
            const particle = document.createElement('div');
            particle.style.cssText = `
                position: absolute;
                width: ${Math.random() * 4 + 1.5}px;
                height: ${Math.random() * 4 + 1.5}px;
                background: radial-gradient(circle, rgba(201,169,110,0.55), transparent);
                border-radius: 50%;
                left: ${Math.random() * 100}%;
                top: ${Math.random() * 100}%;
                pointer-events: none;
                animation: particleFade ${Math.random() * 5 + 4}s ease-in-out infinite;
                animation-delay: ${Math.random() * 4}s;
            `;
            particlesContainer.appendChild(particle);
        }

        for (let i = 0; i < 35; i++) {
            createParticle();
        }

        const particleStyle = document.createElement('style');
        particleStyle.textContent = `
            @keyframes particleFade {
                0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
                50% { opacity: 0.8; transform: translateY(-28px) scale(1); }
            }
        `;
        document.head.appendChild(particleStyle);
    }

    // ---------- Testimonials Slider ----------
    const track = document.getElementById('testimonialsTrack');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const dotsContainer = document.getElementById('sliderDots');

    if (track && prevBtn && nextBtn && dotsContainer) {
        let currentSlide = 0;
        let slidesPerView = 3;

        function updateSlidesPerView() {
            if (window.innerWidth <= 768) {
                slidesPerView = 1;
            } else if (window.innerWidth <= 1024) {
                slidesPerView = 2;
            } else {
                slidesPerView = 3;
            }
        }

        function getTotalSlides() {
            return Math.max(1, track.children.length - slidesPerView + 1);
        }

        function createDots() {
            dotsContainer.innerHTML = '';
            const total = getTotalSlides();
            for (let i = 0; i < total; i++) {
                const dot = document.createElement('button');
                dot.classList.add('slider-dot');
                if (i === 0) dot.classList.add('active');
                dot.addEventListener('click', () => goToSlide(i));
                dotsContainer.appendChild(dot);
            }
        }

        function goToSlide(index) {
            const total = getTotalSlides();
            currentSlide = Math.max(0, Math.min(index, total - 1));
            const card = track.children[0];
            if (!card) return;
            const cardWidth = card.offsetWidth + 24;
            track.style.transform = `translateX(-${currentSlide * cardWidth}px)`;
            dotsContainer.querySelectorAll('.slider-dot').forEach((dot, i) => {
                dot.classList.toggle('active', i === currentSlide);
            });
        }

        prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1));
        nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1));

        let autoSlide = setInterval(() => {
            const total = getTotalSlides();
            goToSlide(currentSlide >= total - 1 ? 0 : currentSlide + 1);
        }, 5000);

        track.addEventListener('mouseenter', () => clearInterval(autoSlide));
        track.addEventListener('mouseleave', () => {
            autoSlide = setInterval(() => {
                const total = getTotalSlides();
                goToSlide(currentSlide >= total - 1 ? 0 : currentSlide + 1);
            }, 5000);
        });

        // Touch swipe support for mobile
        let touchStartX = 0;
        let touchEndX = 0;
        track.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            clearInterval(autoSlide);
        }, { passive: true });

        track.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            const diff = touchStartX - touchEndX;
            if (Math.abs(diff) > 40) {
                if (diff > 0) goToSlide(currentSlide + 1);
                else goToSlide(currentSlide - 1);
            }
        }, { passive: true });

        updateSlidesPerView();
        createDots();

        window.addEventListener('resize', () => {
            updateSlidesPerView();
            createDots();
            goToSlide(0);
        });
    }

    // ---------- Photo placeholders: a soft shimmer until each photo arrives, then a fade ----------
    function fadeIn(img) {
        if (!img) return;
        const done = () => {
            img.classList.add('is-loaded');
            if (img.parentElement) img.parentElement.classList.add('ph-done');
        };
        if (img.complete && img.naturalWidth > 0) return done();
        img.classList.add('img-fade');
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
    }
    document.querySelectorAll('.card-image img, .gallery-item img, .about-img-main img, .about-img-accent img').forEach(fadeIn);

    // ---------- Catalogue (live from the bakery's product list) ----------
    const productsGrid = document.getElementById('productsGrid');
    const orderItem = document.getElementById('orderItem');
    const itemRow = document.getElementById('itemRow');
    const fallbackImages = ['chocolate', 'vanilla', 'redvelvet', 'macarons', 'pastries'].map(n => `/site/images/${n}.jpg`);

    function rupees(paise) {
        const value = paise / 100;
        return '₹' + value.toLocaleString('en-IN', {
            minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function productCard(product, index) {
        const card = el('div', 'specialty-card');
        card.dataset.productId = product.id;

        const imageWrap = el('div', 'card-image');
        const img = el('img');
        img.src = product.image_url || fallbackImages[index % fallbackImages.length];
        img.alt = product.name;
        img.loading = 'lazy';
        imageWrap.appendChild(img);
        const eggless = product.variants.some(v => v.is_eggless);
        if (eggless) {
            const overlay = el('div', 'card-overlay');
            overlay.appendChild(el('span', 'card-tag', 'Eggless option'));
            imageWrap.appendChild(overlay);
        }

        const content = el('div', 'card-content');
        const meta = el('div', 'card-meta');
        meta.appendChild(el('span', 'card-category', product.category));
        meta.appendChild(el('span', 'card-diet', product.contains_egg ? 'Contains egg' : 'Egg-free'));
        content.appendChild(meta);
        content.appendChild(el('h3', 'card-title', product.name));
        if (product.description) content.appendChild(el('p', 'card-desc', product.description));
        const footer = el('div', 'card-footer');
        const prices = product.variants.map(v => v.price_paise);
        const single = prices.every(p => p === prices[0]);
        footer.appendChild(el('span', 'card-price', (single ? '' : 'From ') + rupees(product.from_paise)));
        footer.appendChild(el('button', 'card-btn', 'Order →'));
        content.appendChild(footer);

        card.appendChild(imageWrap);
        card.appendChild(content);
        return card;
    }

    function fillItemPicker(products) {
        if (!orderItem || !itemRow) return;
        products.forEach(product => {
            const group = document.createElement('optgroup');
            group.label = product.name;
            product.variants.forEach(v => {
                const option = el('option', null, `${product.name} — ${v.name} (${rupees(v.price_paise)})${v.is_eggless ? ' · eggless' : ''}`);
                option.value = v.id;
                option.dataset.productId = product.id;
                group.appendChild(option);
            });
            orderItem.appendChild(group);
        });
        itemRow.hidden = false;
    }

    function skeletonCard() {
        const card = el('div', 'specialty-card skeleton');
        card.setAttribute('aria-hidden', 'true');
        card.appendChild(el('div', 'card-image'));
        const content = el('div', 'card-content');
        ['short', 'title', 'line', 'line', 'price'].forEach(kind => content.appendChild(el('div', 'skeleton-bar ' + kind)));
        card.appendChild(content);
        return card;
    }

    async function loadCatalogue() {
        if (!productsGrid) return;
        const cta = productsGrid.querySelector('.specialty-cta');
        const skeletons = Array.from({ length: 6 }, skeletonCard);
        skeletons.forEach(s => productsGrid.insertBefore(s, cta));
        productsGrid.classList.add('is-loading');
        productsGrid.setAttribute('aria-busy', 'true');
        let products = [];
        try {
            const res = await fetch('/api/site/catalogue');
            if (res.ok) products = (await res.json()).products || [];
        } catch {
            // Offline or the server is down: the showcase cards and WhatsApp still work.
        }
        skeletons.forEach(s => s.remove());
        productsGrid.classList.remove('is-loading');
        productsGrid.removeAttribute('aria-busy');
        if (!Array.isArray(products) || products.length === 0) return; // keep the showcase cards
        productsGrid.querySelectorAll('.specialty-card:not(.specialty-cta)').forEach(c => c.remove());
        products.forEach((p, i) => {
            const card = productCard(p, i);
            productsGrid.insertBefore(card, cta);
            fadeIn(card.querySelector('img'));
            bindTilt(card);
        });
        fillItemPicker(products);
    }
    loadCatalogue();

    // ---------- Reviews and gallery (from the admin) ----------
    function reviewCard(review) {
        const card = el('div', 'testimonial-card');
        card.appendChild(el('div', 'testimonial-stars', '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating)));
        card.lastChild.setAttribute('aria-label', `${review.rating} out of 5 stars`);
        card.appendChild(el('p', 'testimonial-text', `“${review.comment}”`));
        const author = el('div', 'testimonial-author');
        author.appendChild(el('div', 'author-avatar', review.name.trim().charAt(0).toUpperCase()));
        const who = el('div');
        who.appendChild(el('h4', null, review.name));
        who.appendChild(el('span', null, new Date(review.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })));
        author.appendChild(who);
        card.appendChild(author);
        return card;
    }

    // Gallery photos added by the bakery replace the built-in ones (the layout pattern repeats every six).
    function galleryItem(photo, index) {
        const item = el('div', `gallery-item gi-${(index % 6) + 1}`);
        const img = el('img');
        img.src = photo.image_url;
        img.alt = photo.caption || 'La Patisserie creation';
        img.loading = 'lazy';
        img.decoding = 'async';
        item.appendChild(img);
        if (photo.caption) {
            const hover = el('div', 'gallery-hover');
            hover.appendChild(el('span', null, photo.caption));
            item.appendChild(hover);
        }
        fadeIn(img);
        return item;
    }

    async function loadContent() {
        let content = { reviews: [], gallery: [] };
        try {
            const res = await fetch('/api/site/content');
            if (res.ok) content = await res.json();
        } catch {
            return;
        }
        const galleryGrid = document.querySelector('#gallery .gallery-grid');
        if (galleryGrid && content.gallery && content.gallery.length) {
            galleryGrid.replaceChildren(...content.gallery.map(galleryItem));
            galleryGrid.classList.add('gallery-live');
        }
        const reviewsList = document.getElementById('reviewsList');
        const track = document.getElementById('testimonialsTrack');
        if (reviewsList && track && content.reviews && content.reviews.length) {
            content.reviews.forEach(r => track.appendChild(reviewCard(r)));
            reviewsList.hidden = false;
            // The slider sizes itself on resize: let it count the new cards.
            window.dispatchEvent(new Event('resize'));
        }
    }
    loadContent();

    const reviewForm = document.getElementById('reviewForm');
    const reviewStatus = document.getElementById('reviewStatus');
    if (reviewForm) {
        reviewForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const say = (message, success) => {
                reviewStatus.textContent = message;
                reviewStatus.classList.toggle('success', Boolean(success));
                reviewStatus.hidden = false;
            };
            const rating = parseInt(reviewForm.querySelector('input[name="rating"]:checked')?.value || '0', 10);
            const name = document.getElementById('reviewName').value.trim();
            const comment = document.getElementById('reviewComment').value.trim();
            if (!rating) return say('Please choose 1 to 5 stars.');
            if (!name || !comment) return say('Please enter your name and your review.');

            const btn = reviewForm.querySelector('button[type="submit"]');
            btn.disabled = true;
            try {
                const res = await fetch('/api/site/review', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, rating, comment, website: document.getElementById('reviewWebsite').value })
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && result.ok) {
                    say('Thank you! Your review will appear here once we have read it.', true);
                    reviewForm.reset();
                } else {
                    say(result.message || 'Sorry, we could not send your review. Please try again.');
                }
            } catch {
                say('Could not reach us. Check your internet connection and try again.');
            } finally {
                btn.disabled = false;
            }
        });
    }

    // ---------- Order Form (sends the order to the bakery) ----------
    const contactForm = document.getElementById('contactForm');
    const formStatus = document.getElementById('formStatus');
    const pickupDate = document.getElementById('pickupDate');
    let orderKey = newKey();

    function newKey() {
        if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function todayInChennai() {
        return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    }

    function showStatus(message, success) {
        if (!formStatus) return;
        formStatus.textContent = message;
        formStatus.classList.toggle('success', Boolean(success));
        formStatus.hidden = false;
    }

    if (pickupDate) pickupDate.min = todayInChennai();

    document.querySelectorAll('input[name="fulfilment"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (!radio.checked) return;
            const label = document.getElementById('addressLabel');
            if (label) label.textContent = radio.value === 'setup' ? 'Address for set-up' : 'Your address (optional, for the cab)';
        });
    });

    if (contactForm) {
        contactForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const value = id => (document.getElementById(id)?.value || '').trim();
            const fulfilment = contactForm.querySelector('input[name="fulfilment"]:checked')?.value || 'collect';
            const variantId = orderItem ? orderItem.value : '';
            const quantity = parseInt(value('orderQty'), 10) || 1;

            if (!value('name') || !value('phone')) return showStatus('Please enter your name and phone number.');
            if (!value('pickupDate') || !value('pickupTime')) return showStatus('Please choose the date and time you need it.');
            if (!variantId && !value('message')) return showStatus('Please tell us what you would like to order.');
            if (fulfilment === 'setup' && !value('setupAddress')) return showStatus('Please enter the address where we should set up.');

            const btn = contactForm.querySelector('button[type="submit"]');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<span>Sending...</span>';
            btn.disabled = true;
            if (formStatus) formStatus.hidden = true;

            try {
                const res = await fetch('/api/site/order', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        idempotencyKey: orderKey,
                        name: value('name'),
                        phone: value('phone'),
                        email: value('email'),
                        date: value('pickupDate'),
                        time: value('pickupTime'),
                        orderType: value('orderType'),
                        message: value('message'),
                        items: variantId ? [{ variantId, quantity }] : [],
                        fulfilment,
                        setupAddress: value('setupAddress'),
                        setupNote: value('setupNote'),
                        website: value('website')
                    })
                });
                const result = await res.json().catch(() => ({}));
                if (res.ok && result.ok) {
                    showStatus(
                        (result.reference ? `Thank you! Your order ${result.reference} has reached us. ` : 'Thank you! Your order has reached us. ') +
                        'We will call you to confirm it and the price.',
                        true
                    );
                    contactForm.reset();
                    const addressLabel = document.getElementById('addressLabel');
                    if (addressLabel) addressLabel.textContent = 'Your address (optional, for the cab)';
                    orderKey = newKey();
                } else {
                    showStatus(result.message || 'Sorry, we could not send your order. Please WhatsApp or call us.');
                }
            } catch {
                // The same key is kept, so trying again cannot create a second order.
                showStatus('Could not reach us. Check your internet connection and try again, or WhatsApp us.');
            } finally {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        });
    }

    // ---------- Subtle Magnetic Buttons (reduced intensity) ----------
    document.querySelectorAll('.btn-primary, .nav-cta').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            btn.style.transform = `translate(${x * 0.1}px, ${y * 0.1}px)`;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = '';
        });
    });

    // ---------- Card 3D Tilt (reduced intensity) ----------
    document.querySelectorAll('.specialty-card').forEach(bindTilt);

    function bindTilt(card) {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;
            const rotateX = (y - 0.5) * -5;
            const rotateY = (x - 0.5) * 5;
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-10px)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    }

    // ---------- Subtle Parallax on Scroll ----------
    const heroImg = document.querySelector('.hero-img');
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        if (heroImg && scrolled < window.innerHeight) {
            // very gentle parallax; CSS animation handles the base zoom
            heroImg.style.transform = `scale(${1.0 + scrolled * 0.00008}) translateY(${scrolled * 0.18}px)`;
        }
    }, { passive: true });

    // ---------- Scroll Reading Progress & Back-to-Top ----------
    const scrollProgress = document.getElementById('scrollProgress');
    const backToTopBtn = document.getElementById('backToTop');

    window.addEventListener('scroll', () => {
        const totalHeight = document.documentElement.scrollHeight - window.innerHeight;
        if (totalHeight > 0 && scrollProgress) {
            const progress = (window.scrollY / totalHeight) * 100;
            scrollProgress.style.width = `${progress}%`;
        }
        if (backToTopBtn) {
            if (window.scrollY > 400) {
                backToTopBtn.classList.add('visible');
            } else {
                backToTopBtn.classList.remove('visible');
            }
        }
    }, { passive: true });

    if (backToTopBtn) {
        backToTopBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---------- Product Card "Order →" Quick Action ----------
    // One listener on the grid, so cards loaded from the catalogue work too.
    if (productsGrid) {
        productsGrid.addEventListener('click', (e) => {
            const btn = e.target.closest('.card-btn');
            if (!btn) return;
            e.preventDefault();
            const card = btn.closest('.specialty-card');
            const title = card ? card.querySelector('.card-title')?.textContent?.trim() : '';
            const category = card ? card.querySelector('.card-category')?.textContent?.trim().toLowerCase() : '';
            const price = card ? card.querySelector('.card-price')?.textContent?.trim() : '';

            const orderTypeSelect = document.getElementById('orderType');
            if (orderTypeSelect && category) {
                if (category.includes('wedding')) orderTypeSelect.value = 'wedding';
                else if (category.includes('cake')) orderTypeSelect.value = 'birthday';
                else if (category.includes('macaron')) orderTypeSelect.value = 'macarons';
                else if (category.includes('pastr')) orderTypeSelect.value = 'pastries';
                else orderTypeSelect.value = 'custom';
            }

            // A product from the catalogue: pick it in the form (its first size).
            const productId = card ? card.dataset.productId : '';
            const firstSize = productId && orderItem ? orderItem.querySelector(`option[data-product-id="${productId}"]`) : null;
            const messageEl = document.getElementById('message');
            if (firstSize) {
                orderItem.value = firstSize.value;
            } else if (messageEl && title) {
                messageEl.value = `Hi, I would like to order the ${title} (${price}). Please let me know the availability!`;
                messageEl.dispatchEvent(new Event('input', { bubbles: true }));
            }

            const contactSection = document.getElementById('contact');
            const formWrapper = document.querySelector('.contact-form-wrapper');
            if (contactSection) {
                contactSection.scrollIntoView({ behavior: 'smooth' });
                if (formWrapper) {
                    formWrapper.classList.remove('form-highlight');
                    void formWrapper.offsetWidth;
                    formWrapper.classList.add('form-highlight');
                }
                const nameInput = document.getElementById('name');
                if (nameInput) setTimeout(() => nameInput.focus(), 600);
            }
        });
    }

    // ---------- Direct WhatsApp Order Action ----------
    const orderViaWhatsappBtn = document.getElementById('orderViaWhatsapp');
    if (orderViaWhatsappBtn) {
        orderViaWhatsappBtn.addEventListener('click', () => {
            const name = document.getElementById('name')?.value.trim() || 'A Customer';
            const orderType = document.getElementById('orderType')?.value || 'Inquiry';
            const message = document.getElementById('message')?.value.trim() || 'I would like to inquire about your pastries.';
            const item = orderItem && orderItem.value ? orderItem.selectedOptions[0].textContent : '';
            const quantity = document.getElementById('orderQty')?.value || '1';
            const date = document.getElementById('pickupDate')?.value || '';
            const time = document.getElementById('pickupTime')?.value || '';

            const text = encodeURIComponent(
                `*New Order Inquiry — La Patisserie Madras*\n` +
                `👤 *Name:* ${name}\n` +
                `🎂 *Type:* ${orderType}\n` +
                (item ? `🛍️ *Item:* ${item} × ${quantity}\n` : '') +
                (date ? `📅 *Needed:* ${date} ${time}\n` : '') +
                `📝 *Details:* ${message}`
            );
            window.open(`https://wa.me/919884882516?text=${text}`, '_blank');
        });
    }

    // ---------- Luxury Gallery Lightbox ----------
    const lightbox = document.getElementById('imageLightbox');
    const lightboxImg = document.getElementById('lightboxImg');
    const lightboxCaption = document.getElementById('lightboxCaption');
    const lightboxClose = document.getElementById('lightboxClose');

    function openLightbox(imgSrc, captionText) {
        if (!lightbox || !lightboxImg) return;
        lightboxImg.src = imgSrc;
        lightboxCaption.textContent = captionText || '';
        lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        if (!lightbox) return;
        lightbox.classList.remove('active');
        document.body.style.overflow = '';
    }

    // Delegated, so gallery photos loaded from the bakery open too.
    document.addEventListener('click', (e) => {
        const item = e.target.closest && e.target.closest('.gallery-item');
        if (!item) return;
        const img = item.querySelector('img');
        const caption = item.querySelector('.gallery-hover span')?.textContent;
        if (img) openLightbox(img.src, caption);
    });

    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target === lightbox) closeLightbox();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && lightbox && lightbox.classList.contains('active')) {
            closeLightbox();
        }
    });

    // ---------- Lazy load images below the fold ----------
    if ('loading' in HTMLImageElement.prototype) {
        document.querySelectorAll('img:not(.hero-img)').forEach(img => {
            img.loading = 'lazy';
        });
    }

});
