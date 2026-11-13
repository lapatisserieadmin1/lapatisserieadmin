/* ============================================
   LA PATISSERIE MADRAS — Interactive Scripts
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

    // ---------- Preloader ----------
    const preloader = document.getElementById('preloader');
    window.addEventListener('load', () => {
        setTimeout(() => {
            preloader.classList.add('hidden');
            document.body.style.overflow = '';
            initAnimations();
        }, 1200);
    });

    // Fallback in case load fires before DOMContentLoaded listener
    setTimeout(() => {
        if (!preloader.classList.contains('hidden')) {
            preloader.classList.add('hidden');
            document.body.style.overflow = '';
            initAnimations();
        }
    }, 3000);

    // ---------- Sparkle Cursor Effect ----------
    const sparkleCanvas = document.getElementById('sparkle-canvas');
    const ctx = sparkleCanvas.getContext('2d');
    let sparkles = [];
    let mouse = { x: -100, y: -100 };

    function resizeCanvas() {
        sparkleCanvas.width = window.innerWidth;
        sparkleCanvas.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    document.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX;
        mouse.y = e.clientY;

        // Spawn sparkles on movement
        if (Math.random() > 0.5) {
            for (let i = 0; i < 2; i++) {
                sparkles.push({
                    x: mouse.x + (Math.random() - 0.5) * 20,
                    y: mouse.y + (Math.random() - 0.5) * 20,
                    size: Math.random() * 3 + 1,
                    speedX: (Math.random() - 0.5) * 2,
                    speedY: (Math.random() - 0.5) * 2 - 1,
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

        // Draw a 4-pointed star
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
            s.opacity *= 0.96;
            s.rotation += 0.05;
            s.size *= 0.98;
            drawSparkle(s);
        });
        requestAnimationFrame(animateSparkles);
    }
    animateSparkles();

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

        // Active section detection
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
    });

    navLinksContainer.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            hamburger.classList.remove('active');
            navLinksContainer.classList.remove('open');
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

    // ---------- Scroll Animations ----------
    function initAnimations() {
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
            threshold: 0.15,
            rootMargin: '0px 0px -50px 0px'
        });

        document.querySelectorAll('[data-animate]').forEach(el => {
            observer.observe(el);
        });
    }

    // ---------- Counter Animation ----------
    function animateCounters() {
        const counters = document.querySelectorAll('[data-count]');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const counter = entry.target;
                    const target = parseInt(counter.dataset.count);
                    const duration = 2000;
                    const start = performance.now();

                    function update(now) {
                        const elapsed = now - start;
                        const progress = Math.min(elapsed / duration, 1);

                        // Ease out quart
                        const eased = 1 - Math.pow(1 - progress, 4);
                        counter.textContent = Math.floor(eased * target);

                        if (progress < 1) {
                            requestAnimationFrame(update);
                        } else {
                            counter.textContent = target;
                        }
                    }

                    requestAnimationFrame(update);
                    observer.unobserve(counter);
                }
            });
        }, { threshold: 0.5 });

        counters.forEach(c => observer.observe(c));
    }
    animateCounters();

    // ---------- Hero Particles ----------
    const particlesContainer = document.getElementById('heroParticles');
    function createParticle() {
        const particle = document.createElement('div');
        particle.style.cssText = `
            position: absolute;
            width: ${Math.random() * 5 + 2}px;
            height: ${Math.random() * 5 + 2}px;
            background: radial-gradient(circle, rgba(201,169,110,0.6), transparent);
            border-radius: 50%;
            left: ${Math.random() * 100}%;
            top: ${Math.random() * 100}%;
            pointer-events: none;
            animation: particleFade ${Math.random() * 4 + 3}s ease-in-out infinite;
            animation-delay: ${Math.random() * 3}s;
        `;
        particlesContainer.appendChild(particle);
    }

    for (let i = 0; i < 40; i++) {
        createParticle();
    }

    // Add particle animation keyframes
    const particleStyle = document.createElement('style');
    particleStyle.textContent = `
        @keyframes particleFade {
            0%, 100% { opacity: 0; transform: translateY(0) scale(0.5); }
            50% { opacity: 1; transform: translateY(-30px) scale(1); }
        }
    `;
    document.head.appendChild(particleStyle);

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
            const cardWidth = card.offsetWidth + 24; // gap
            track.style.transform = `translateX(-${currentSlide * cardWidth}px)`;

            dotsContainer.querySelectorAll('.slider-dot').forEach((dot, i) => {
                dot.classList.toggle('active', i === currentSlide);
            });
        }

        prevBtn.addEventListener('click', () => goToSlide(currentSlide - 1));
        nextBtn.addEventListener('click', () => goToSlide(currentSlide + 1));

        // Auto-advance
        let autoSlide = setInterval(() => {
            const total = getTotalSlides();
            goToSlide(currentSlide >= total - 1 ? 0 : currentSlide + 1);
        }, 5000);

        // Pause on hover
        track.addEventListener('mouseenter', () => clearInterval(autoSlide));
        track.addEventListener('mouseleave', () => {
            autoSlide = setInterval(() => {
                const total = getTotalSlides();
                goToSlide(currentSlide >= total - 1 ? 0 : currentSlide + 1);
            }, 5000);
        });

        updateSlidesPerView();
        createDots();

        window.addEventListener('resize', () => {
            updateSlidesPerView();
            createDots();
            goToSlide(0);
        });
    }

    // ---------- Contact Form ----------
    const contactForm = document.getElementById('contactForm');
    contactForm.addEventListener('submit', (e) => {
        e.preventDefault();

        const btn = contactForm.querySelector('button[type="submit"]');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>Sending...</span>';
        btn.disabled = true;

        setTimeout(() => {
            btn.innerHTML = '<span>✓ Order Received!</span>';
            btn.style.background = 'linear-gradient(135deg, #2d6a4f, #40916c)';

            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.background = '';
                btn.disabled = false;
                contactForm.reset();
            }, 3000);
        }, 1500);
    });

    // ---------- Magnetic Buttons ----------
    document.querySelectorAll('.btn-primary, .nav-cta').forEach(btn => {
        btn.addEventListener('mousemove', (e) => {
            const rect = btn.getBoundingClientRect();
            const x = e.clientX - rect.left - rect.width / 2;
            const y = e.clientY - rect.top - rect.height / 2;
            btn.style.transform = `translate(${x * 0.15}px, ${y * 0.15}px)`;
        });

        btn.addEventListener('mouseleave', () => {
            btn.style.transform = '';
        });
    });

    // ---------- Image Tilt on Hover ----------
    document.querySelectorAll('.specialty-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const y = (e.clientY - rect.top) / rect.height;

            const rotateX = (y - 0.5) * -8;
            const rotateY = (x - 0.5) * 8;

            card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
        });
    });

    // ---------- Parallax on Scroll ----------
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        const heroImg = document.querySelector('.hero-img');
        if (heroImg && scrolled < window.innerHeight) {
            heroImg.style.transform = `scale(${1.05 + scrolled * 0.0002}) translateY(${scrolled * 0.3}px)`;
        }
    }, { passive: true });

    // ---------- Gallery Lightbox effect (scale up on click) ----------
    document.querySelectorAll('.gallery-item').forEach(item => {
        item.addEventListener('click', () => {
            item.style.zIndex = '10';
            item.style.transform = 'scale(1.05)';
            item.style.transition = 'transform 0.3s ease';

            setTimeout(() => {
                item.style.transform = '';
                item.style.zIndex = '';
            }, 600);
        });
    });

    // ---------- Typing effect for hero subtitle ----------
    const heroSubtitle = document.querySelector('.hero-subtitle');
    if (heroSubtitle) {
        const text = heroSubtitle.textContent;
        heroSubtitle.textContent = '';
        heroSubtitle.style.opacity = '1';

        setTimeout(() => {
            let i = 0;
            function type() {
                if (i < text.length) {
                    heroSubtitle.textContent += text.charAt(i);
                    i++;
                    setTimeout(type, 25);
                }
            }
            type();
        }, 1800);
    }
});
