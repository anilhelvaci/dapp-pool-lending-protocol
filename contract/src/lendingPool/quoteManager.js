export const makeQuoteManager = (initialQuote) => {
  let latestQuote = initialQuote;

  const updateLatestQuote = (newQuote) => {
    latestQuote = newQuote;
  };

  const getLatestQuote = () => {
    let quote = latestQuote;
    return quote;
  };

  return harden({
    updateLatestQuote,
    getLatestQuote
  })
}