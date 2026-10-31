/* Single source for the replaceable product brand. */
(function (root) {
  const brand = { name: "Oakstone Financial", shortName: "Oakstone", tagline: "Private operations, clearly managed." };
  if (typeof module !== "undefined" && module.exports) module.exports = brand;
  if (root) root.OAKSTONE_BRAND = brand;
})(typeof window !== "undefined" ? window : globalThis);
