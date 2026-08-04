import { describe, expect, it } from 'vitest';
import { inferInteractionGatedElements } from '../../../src/spec/inferInteractionGatedElements.js';

describe('inferInteractionGatedElements', () => {
  it('flags the real grading.tsx shape: a button whose click gates a results block', () => {
    const source = `
      const [showResults, setShowResults] = useState(false);
      return (
        <div>
          <button onClick={() => setShowResults(true)}>Calculate ROI</button>
          {showResults && (
            <div>Results here</div>
          )}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([
      { buttonText: 'Calculate ROI', gatedStateVars: ['showResults'] }
    ]);
  });

  it('does not flag a state variable that is set but never gated elsewhere (e.g. an analytics-only toggle)', () => {
    const source = `
      const [clicked, setClicked] = useState(false);
      return <button onClick={() => setClicked(true)}>Track</button>;
    `;
    expect(inferInteractionGatedElements(source)).toEqual([]);
  });

  it('does not flag a button with no onClick at all', () => {
    const source = `
      const [x, setX] = useState(false);
      return <button>Cancel</button>;
    `;
    expect(inferInteractionGatedElements(source)).toEqual([]);
  });

  it('does not flag a button whose onClick references a separately-defined handler (named limitation)', () => {
    const source = `
      const [open, setOpen] = useState(false);
      function handleClick() { setOpen(true); }
      return (
        <div>
          <button onClick={handleClick}>Open</button>
          {open && <div>Panel</div>}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([]);
  });

  it('flags only the button that gates real content when two buttons exist', () => {
    const source = `
      const [a, setA] = useState(false);
      const [b, setB] = useState(false);
      return (
        <div>
          <button onClick={() => setA(true)}>First</button>
          <button onClick={() => setB(true)}>Second</button>
          {b && <div>Second content</div>}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([{ buttonText: 'Second', gatedStateVars: ['b'] }]);
  });

  it('reports only the gated state variable when one onClick sets two, only one of which is gated', () => {
    const source = `
      const [loading, setLoading] = useState(false);
      const [result, setResult] = useState(false);
      return (
        <div>
          <button onClick={() => { setLoading(true); setResult(true); }}>Go</button>
          {result && <div>Result content</div>}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([{ buttonText: 'Go', gatedStateVars: ['result'] }]);
  });

  it('flags a ternary-gated conditional, not just &&', () => {
    const source = `
      const [tab, setTab] = useState(false);
      return (
        <div>
          <button onClick={() => setTab(true)}>Switch</button>
          {tab ? <div>Tab B</div> : <div>Tab A</div>}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([{ buttonText: 'Switch', gatedStateVars: ['tab'] }]);
  });

  it('does not flag a state variable used only for inline styling comparison, not a render gate', () => {
    const source = `
      const [selectedService, setSelectedService] = useState('PSA');
      return (
        <div>
          <button onClick={() => setSelectedService('PSA')} style={{ background: selectedService === 'PSA' ? 'red' : 'blue' }}>PSA</button>
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([]);
  });

  it('correctly isolates the opening tag when the condition contains a nested call with its own parens', () => {
    const source = `
      const [ready, setReady] = useState(false);
      return (
        <div>
          <button onClick={() => setReady(value > 5)}>Check</button>
          {ready && <div>Ready content</div>}
        </div>
      );
    `;
    expect(inferInteractionGatedElements(source)).toEqual([{ buttonText: 'Check', gatedStateVars: ['ready'] }]);
  });

  it('returns an empty array for a page with no useState at all', () => {
    const source = `export default function Home() { return <div>Static page</div>; }`;
    expect(inferInteractionGatedElements(source)).toEqual([]);
  });
});
