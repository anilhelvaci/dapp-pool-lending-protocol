export const makeQuoteManager = () => {
  let latestQuote;

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