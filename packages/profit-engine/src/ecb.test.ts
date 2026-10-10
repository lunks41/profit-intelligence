import { describe, expect, it } from 'vitest';
import { ecbCurrencies, ecbProvider, parseEcbXml } from './ecb.js';
import { convertMoney, firstOf, pegProvider } from './fx.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <Cube>
    <Cube time='2026-10-09'>
      <Cube currency='USD' rate='1.1000'/>
      <Cube currency='GBP' rate='0.8500'/>
      <Cube currency='INR' rate='95.0000'/>
    </Cube>
    <Cube time='2026-10-08'>
      <Cube currency='USD' rate='1.0000'/>
      <Cube currency='GBP' rate='0.8000'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe('reading the ECB file', () => {
  it('returns one rate per day and currency', () => {
    expect(parseEcbXml(XML)).toEqual([
      { date: '2026-10-09', quote: 'USD', rate: '1.1000' },
      { date: '2026-10-09', quote: 'GBP', rate: '0.8500' },
      { date: '2026-10-09', quote: 'INR', rate: '95.0000' },
      { date: '2026-10-08', quote: 'USD', rate: '1.0000' },
      { date: '2026-10-08', quote: 'GBP', rate: '0.8000' },
    ]);
  });

  it('skips anything that is not a real date, a currency code and a positive number', () => {
    const bad = `<Cube><Cube time='2026-02-31'><Cube currency='USD' rate='1.1'/></Cube>
      <Cube time='2026-10-09'><Cube currency='usd' rate='1.1'/><Cube currency='GBP' rate='0'/>
      <Cube currency='JPY' rate='abc'/><Cube currency='CHF' rate='0.95'/></Cube></Cube>`;
    expect(parseEcbXml(bad)).toEqual([{ date: '2026-10-09', quote: 'CHF', rate: '0.95' }]);
  });

  it('an empty or foreign file gives nothing', () => {
    expect(parseEcbXml('')).toEqual([]);
    expect(parseEcbXml('<html>not it</html>')).toEqual([]);
  });
});

describe('rates between any two currencies', () => {
  const rates = parseEcbXml(XML);
  const p = ecbProvider(rates);

  it('euro to a currency is the published rate', () => {
    expect(p.getRate('EUR', 'USD', '2026-10-09')).toMatchObject({
      rate: '1.1000000000',
      status: 'actual',
      date: '2026-10-09',
    });
  });

  it('a currency to euro is the inverse', () => {
    expect(p.getRate('USD', 'EUR', '2026-10-09')!.rate).toBe('0.9090909091');
  });

  it('two currencies are crossed through the euro', () => {
    // 1 GBP = 1.1 / 0.85 USD
    expect(p.getRate('GBP', 'USD', '2026-10-09')!.rate).toBe('1.2941176471');
    expect(p.getRate('USD', 'INR', '2026-10-09')!.rate).toBe('86.3636363636');
  });

  it('uses the rate of the day asked for, never another day when that day exists', () => {
    expect(p.getRate('EUR', 'USD', '2026-10-08')!.rate).toBe('1.0000000000');
  });

  it('a day with no rate uses the latest earlier day and says it is an estimate', () => {
    const r = p.getRate('EUR', 'USD', '2026-10-11'); // a Sunday
    expect(r).toMatchObject({ rate: '1.1000000000', status: 'estimated', date: '2026-10-09' });
  });

  it('does not reach back more than the allowed days, and never forward', () => {
    expect(p.getRate('EUR', 'USD', '2026-10-30')).toBeNull();
    expect(p.getRate('EUR', 'USD', '2026-10-07')).toBeNull();
  });

  it('needs both currencies on the same day: INR was not published on the 8th', () => {
    expect(p.getRate('USD', 'INR', '2026-10-08')).toBeNull();
  });

  it('a currency that is not in the file has no rate', () => {
    expect(p.getRate('EUR', 'XYZ', '2026-10-09')).toBeNull();
  });
});

describe('pegged currencies join the reference rates', () => {
  const pegs = [{ base: 'USD', quote: 'AED', rate: '3.6725' }];
  const p = ecbProvider(parseEcbXml(XML), pegs);

  it('prices AED against any currency in the file, through USD', () => {
    expect(p.getRate('USD', 'AED', '2026-10-09')!.rate).toBe('3.6725000000');
    expect(p.getRate('AED', 'USD', '2026-10-09')!.rate).toBe('0.2722940776');
    // EUR to AED: 1.1 USD per EUR x 3.6725
    expect(p.getRate('EUR', 'AED', '2026-10-09')!.rate).toBe('4.0397500000');
    expect(p.getRate('AED', 'GBP', '2026-10-09')).not.toBeNull();
  });

  it('lists the currencies that can be priced', () => {
    expect(ecbCurrencies(parseEcbXml(XML), pegs)).toEqual(['AED', 'EUR', 'GBP', 'INR', 'USD']);
    expect(ecbCurrencies([], pegs)).toEqual([]);
  });
});

describe('converting with them', () => {
  const rates = parseEcbXml(XML);
  const provider = firstOf(
    pegProvider([{ base: 'USD', quote: 'AED', rate: '3.6725', source: 'peg' }]),
    ecbProvider(rates),
  );

  it('converts at the rate of the entry date and rounds once', () => {
    const c = convertMoney('100.00', 'USD', 'GBP', '2026-10-09', provider);
    expect(c).toMatchObject({ status: 'actual', currency: 'GBP', rateDate: '2026-10-09' });
    if (c.status !== 'missing') expect(c.amount.toFixed(2)).toBe('77.27'); // 100 x 0.85 / 1.1
  });

  it('a missing rate is "missing", never a rate of 1', () => {
    expect(convertMoney('10', 'USD', 'XYZ', '2026-10-09', provider).status).toBe('missing');
  });

  it('a fixed peg still wins where there is one', () => {
    const c = convertMoney('100.00', 'USD', 'AED', '2026-10-09', provider);
    expect(c).toMatchObject({ status: 'actual', source: 'peg' });
  });
});
