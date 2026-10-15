// Logo + "FLOW DOWNLOADER" for the title bar, with a premium light sweep that
// glides across them every 10 seconds (CSS only: "brand-shine" in App.css).
// The sweep is clipped to the actual shapes: the text uses background-clip:text,
// and the logo gets an overlay masked by the logo image itself.

export default function BrandShine({ logo, logoClass = "w-5 h-5", textClass = "" }) {
  return (
    <span className="flex items-center gap-2">
      <span className={`relative inline-block shrink-0 ${logoClass}`}>
        <img src={logo} alt="" className="w-full h-full block" />
        <span
          className="brand-shine-logo"
          style={{ WebkitMaskImage: `url(${logo})`, maskImage: `url(${logo})` }}
          aria-hidden="true"
        />
      </span>
      <span className={`brand-shine-text text-[10px] font-bold tracking-[0.2em] uppercase ${textClass}`}>
        FLOW DOWNLOADER
      </span>
    </span>
  );
}
