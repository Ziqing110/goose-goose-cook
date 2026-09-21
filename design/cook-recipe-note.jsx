import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import BabyGoose from '../src/components/BabyGoose.jsx';
import tofu from '../src/assets/dish-mapo-tofu.png';
import soup from '../src/assets/dish-noodle-soup.png';
import '../src/styles/tokens.css';
import './cook-recipe-note.css';

const dishes = [
  { name: 'Mapo tofu', subtitle: 'A little heat, a lot of comfort.', image: tofu, steps: [
    ['Mince garlic', 'Zoe'], ['Portion & season ground pork', 'Kai'], ['Mince ginger & scallion', 'Zoe'], ['Cut tofu into cubes', 'Kai'], ['Brown pork, then fry doubanjiang & aromatics', 'Zoe'], ['Add stock & bring to a simmer', 'Zoe'], ['Slide in tofu & simmer gently', 'Zoe'], ['Stir in the cornstarch slurry', 'Zoe'], ['Finish with Sichuan pepper & scallion', 'Zoe'], ['Spoon into a serving bowl', 'Zoe'],
  ] },
  { name: 'Chicken noodle soup', subtitle: 'Something warm to share.', image: soup, steps: [
    ['Dice onion, carrot & celery', 'Zoe'], ['Measure stock, bay leaf & thyme', 'Kai'], ['Sauté onion, carrot & celery', 'Zoe'], ['Trim & season chicken', 'Kai'], ['Add chicken & stock', 'Zoe'], ['Simmer until chicken is cooked through', 'Zoe'], ['Shred chicken & return to the pot', 'Zoe'], ['Cook noodles in the broth', 'Zoe'], ['Season & ladle into bowls', 'Zoe'],
  ] },
];
const playerClass = (name) => name === 'Zoe' ? 'zoe' : 'kai';
function Preview() {
  const [filter, setFilter] = useState('Together');
  const [open, setOpen] = useState(['Mapo tofu', 'Chicken noodle soup']);
  const toggle = (name) => setOpen((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  return <div className="recipe-preview">
    <nav className="rn-nav"><a href="/">◴ <strong>Kitchen Path</strong></a><span>THE TABLE IS SET.</span><a href="/">Exit to Home ↗</a></nav>
    <header className="rn-page-head"><div><span className="rn-eyebrow">LIVE COOK / FINISHED</span><h1>Look what you made.</h1><p>A little competition. A dinner made together.</p></div><span className="rn-demo">DESIGN PREVIEW · 示例分工</span></header>
    <main className="rn-layout">
      <div className="rn-paper-wrap">
        <article className="rn-paper" aria-label="Our recipe note">
          <div className="rn-paper-top"><span>FROM OUR KITCHEN</span><span>RECIPE NOTE / 01</span></div>
          <div className="rn-paper-title"><span className="rn-hand">Tonight, we made</span><h2>Mapo tofu <em>&</em><br/>chicken noodle soup.</h2></div>
          <div className="rn-food-art"><figure><img src={tofu} alt="Illustration of a bowl of mapo tofu"/><figcaption>a little spicy</figcaption></figure><figure><img src={soup} alt="Illustration of chicken noodle soup"/><figcaption>a little soothing</figcaption></figure><span className="rn-plus">+</span></div>
          <div className="rn-signatures"><span className="rn-eyebrow">MADE TOGETHER BY</span><div><span className="zoe rn-signature">Zoe</span><span className="rn-amp">×</span><span className="kai rn-signature">Kai</span></div></div>
          <div className="rn-notes"><span className="rn-eyebrow">NOTES FROM THE COUNTER</span><p><i className="rn-dot zoe"/><strong>Zoe</strong><span>From chopping aromatics to the final bowls.</span></p><p><i className="rn-dot kai"/><strong>Kai</strong><span>Prepped the tofu, meat and broth ingredients.</span></p></div>
          <div className="rn-facts"><div><strong>2</strong><span>dishes on the table</span></div><div><strong>19 <small>/ 19</small></strong><span>steps completed</span></div><div><strong>3:27</strong><span>recorded time*</span></div></div>
          <div className="rn-match"><div className="rn-match-goose"><BabyGoose pose="g9-victory" size={85} decorative/><BabyGoose pose="g14-defeat-good-game" size={68} decorative/></div><div><span className="rn-eyebrow">A FRIENDLY RIVALRY</span><strong>Zoe takes this round.</strong><span className="rn-match-score"><b className="zoe">Zoe 229</b><span>:</span><b className="kai">Kai 50</b></span></div><span className="rn-stamp">DINNER<br/>IS SERVED</span></div>
          <footer className="rn-paper-foot">Different hands. Same table.</footer>
        </article>
        <div className="rn-paper-actions"><button onClick={() => window.print()}>Print this recipe note <span>↗</span></button><p>Keep a little record of the meal.</p></div>
      </div>
      <section className="rn-process" aria-label="Cooking steps">
        <div className="rn-process-title"><h2>How we made it</h2><span>19 DONE · 0 SKIPPED</span></div><p className="rn-process-intro">Two dishes, with both of you in the recipe.</p>
        <div className="rn-filters" role="group" aria-label="Filter steps by cook">{['Together', 'Zoe', 'Kai'].map(name => <button key={name} onClick={() => setFilter(name)} aria-pressed={filter === name}>{name !== 'Together' && <i className={`rn-dot ${playerClass(name)}`}/>} {name}<span>{name === 'Together' ? 19 : name === 'Zoe' ? 15 : 4}</span></button>)}</div>
        {dishes.map((dish, i) => { const steps = dish.steps.filter((s) => filter === 'Together' || s[1] === filter); return <section className="rn-dish" key={dish.name}>
          <button className="rn-dish-toggle" aria-expanded={open.includes(dish.name)} aria-controls={`dish-${i}`} onClick={() => toggle(dish.name)}><span className="rn-dish-index">0{i + 1}</span><span><strong>{dish.name}</strong><small>{dish.subtitle}</small></span><span className="rn-dish-count">{steps.length} steps</span><span aria-hidden="true">{open.includes(dish.name) ? '−' : '+'}</span></button>
          <ol id={`dish-${i}`} hidden={!open.includes(dish.name)}>{steps.map(([label, name]) => <li key={label}><span className="rn-step-check" aria-label="Completed">✓</span><span>{label}</span><span className={`rn-owner ${playerClass(name)}`}>{name}</span></li>)}</ol>
        </section>; })}
        <aside className="rn-toque"><BabyGoose pose="g8-toque-neutral" size={53} decorative paused/><p><strong>A note from Toque</strong><span>The points belong to a player.<br/>The dinner belongs to both of you.</span></p></aside>
        <p className="rn-data-note">* 示例预览：沿用截图中的比分与 3:27 用时。步骤与人员分工为排版演示，不代表真实烹饪记录。</p>
      </section>
    </main>
  </div>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
