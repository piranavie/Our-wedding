(() => {
  'use strict';
  // Set this to your deployed Google Apps Script web app URL after setup.
  const RSVP_ENDPOINT = '';

  const stage = document.getElementById('stage');
  const envelope = document.getElementById('envelope');
  const envCard = document.getElementById('envCard');
  const deck = document.getElementById('deck');
  const cards = [...deck.querySelectorAll('.card')];
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const label = document.getElementById('label');
  const dotsEl = document.getElementById('dots');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 400) : ms));

  const dots = cards.map(() => dotsEl.appendChild(document.createElement('i')));
  let index = 0, opened = false;

  function render() {
    cards.forEach((c, i) => {
      c.classList.toggle('current', i === index);
      c.classList.toggle('gone', i < index);
      c.classList.toggle('behind', i > index);
      c.setAttribute('aria-hidden', i === index ? 'false' : 'true');
    });
    dots.forEach((d, i) => d.classList.toggle('on', i === index));
    label.textContent = cards[index].dataset.label;
    prevBtn.disabled = index === 0;
    nextBtn.textContent = index === cards.length - 1 ? 'RSVP →' : 'Next ›';
  }

  function go(n) {
    if (n < 0 || n >= cards.length || n === index) return;
    index = n;
    render();
    const c = cards[index];
    c.classList.remove('shine'); void c.offsetWidth; c.classList.add('shine');
  }

  // Lift the card out of the envelope and grow it into the full-size card (FLIP).
  function liftCard() {
    const first = cards[0];
    const from = envCard.getBoundingClientRect();
    const envTop = envelope.getBoundingClientRect().top;
    stage.classList.add('is-out');
    const to = first.getBoundingClientRect();
    const s = from.width / to.width;
    const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
    const dy = from.top - to.top;
    // Only the part above the envelope's top edge is visible at the start.
    const visible = Math.max(0, envTop - from.top) / s;
    const clipBottom = Math.max(0, 100 - (visible / to.height) * 100);
    envCard.style.visibility = 'hidden';
    first.animate([
      { transformOrigin: '50% 0', transform: `translate(${dx}px,${dy}px) scale(${s})`, clipPath: `inset(0 0 ${clipBottom}% 0 round 4px)`, boxShadow: '0 10px 30px #0006' },
      { transformOrigin: '50% 0', transform: 'translate(0,0) scale(1)', clipPath: 'inset(0 0 0% 0 round 6px)', boxShadow: '0 30px 70px #050102b3' }
    ], { duration: reduced ? 300 : 1300, easing: 'cubic-bezier(.65,0,.35,1)' });
    cards[1].animate([{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: 1 }], { duration: reduced ? 300 : 1500, easing: 'ease-out' });
  }

  async function open() {
    if (opened) return;
    opened = true;
    stage.classList.add('is-open');
    await wait(2700);
    liftCard();
    await wait(1100);
    cards[0].classList.add('shine');
    nextBtn.focus({ preventScroll: true });
  }

  function reset() {
    stage.classList.remove('is-out');
    index = 0;
    render();
    envCard.style.visibility = '';
    // Let the envelope rise back into place, then tuck the card in and close it.
    setTimeout(() => {
      stage.classList.remove('is-open');
      opened = false;
      cards.forEach(c => c.classList.remove('shine'));
    }, reduced ? 50 : 1100);
  }

  envelope.addEventListener('click', open);
  prevBtn.addEventListener('click', () => go(index - 1));
  nextBtn.addEventListener('click', () => index === cards.length - 1 ? showRsvp() : go(index + 1));

  // Tap a card to advance; swipe left/right to move between cards.
  let startX = null, dragX = 0, moved = false;
  deck.addEventListener('pointerdown', e => {
    startX = e.clientX; dragX = 0; moved = false;
    deck.setPointerCapture(e.pointerId);
  });
  deck.addEventListener('pointermove', e => {
    if (startX === null) return;
    dragX = e.clientX - startX;
    if (Math.abs(dragX) > 8) {
      moved = true;
      deck.classList.add('dragging');
      cards[index].style.transform = `translateX(${dragX}px) rotate(${dragX / 30}deg)`;
    }
  });
  const end = () => {
    if (startX === null) return;
    deck.classList.remove('dragging');
    cards[index].style.transform = '';
    if (!moved) index === cards.length - 1 ? showRsvp() : go(index + 1);
    else if (dragX < -60) index === cards.length - 1 ? showRsvp() : go(index + 1);
    else if (dragX > 60) go(index - 1);
    startX = null;
  };
  deck.addEventListener('pointerup', end);
  deck.addEventListener('pointercancel', end);

  document.addEventListener('keydown', e => {
    if (!stage.classList.contains('is-out')) return;
    if (e.key === 'ArrowRight') go(index + 1);
    if (e.key === 'ArrowLeft') go(index - 1);
  });

  const rsvpScreen = document.getElementById('rsvpScreen');
  const rsvpForm = document.getElementById('rsvpForm');
  const rsvpFields = document.getElementById('rsvpFields');
  const guestName = document.getElementById('guestName');
  const guestCount = document.getElementById('guestCount');
  const countGroup = document.getElementById('guestCountGroup');
  const rsvpError = document.getElementById('rsvpError');
  let attending = null;
  function showRsvp(){
    rsvpScreen.classList.add('visible');
    rsvpScreen.setAttribute('aria-hidden','false');
    document.getElementById('attendYes').focus();
  }
  function choose(value){
    attending = value;
    document.getElementById('attendYes').setAttribute('aria-pressed',String(value));
    document.getElementById('attendNo').setAttribute('aria-pressed',String(!value));
    rsvpFields.hidden = false;
    guestName.disabled = false;
    countGroup.hidden = !value;
    guestCount.disabled = !value;
    rsvpError.hidden = true;
    guestName.focus();
  }
  document.getElementById('attendYes').addEventListener('click',()=>choose(true));
  document.getElementById('attendNo').addEventListener('click',()=>choose(false));
  document.getElementById('rsvpBack').addEventListener('click',()=>{
    rsvpScreen.classList.remove('visible');
    rsvpScreen.setAttribute('aria-hidden','true');
    nextBtn.focus();
  });
  rsvpForm.addEventListener('submit',async e=>{
    e.preventDefault();
    if(attending === null) return;
    const submit = document.getElementById('submitRsvp');
    submit.disabled = true;
    submit.textContent = 'Sending…';
    rsvpError.hidden = true;
    try{
      if (!RSVP_ENDPOINT) throw new Error('RSVP submissions are not configured yet. Please contact the couple.');
      const response = await fetch(RSVP_ENDPOINT,{
        method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({name:guestName.value.trim(),attending,guests:attending?Number(guestCount.value):0})
      });
      const result = await response.json();
      if(!response.ok || !result.ok) throw new Error(result.error || 'Unable to save your RSVP. Please try again.');
      rsvpForm.hidden = true;
      document.getElementById('rsvpTitle').textContent = 'Thank you!';
      document.getElementById('rsvpIntro').hidden = true;
      document.getElementById('rsvpThanks').hidden = false;
      document.getElementById('rsvpThanksText').textContent = attending
        ? `We are delighted you can join us! Your RSVP for ${guestCount.value} ${Number(guestCount.value)===1?'guest':'guests'} has been received.`
        : 'Thank you for letting us know. You will be missed, and we appreciate your warm wishes.';
    }catch(err){
      rsvpError.textContent = err.message || 'Something went wrong. Please try again.';
      rsvpError.hidden = false;
    }finally{
      submit.disabled = false;
      submit.textContent = 'Send my RSVP →';
    }
  });

  render();

  const petals = document.getElementById('petals');
  for (let i = 0; i < 17; i++) {
    const p = document.createElement('i');
    p.className = 'petal';
    p.style.left = (i * 37 % 100) + '%';
    p.style.animationDuration = (9 + (i * 7 % 8)) + 's';
    p.style.animationDelay = (-i * 1.3) + 's';
    p.style.opacity = .2 + (i % 5) * .09;
    petals.appendChild(p);
  }
})();
