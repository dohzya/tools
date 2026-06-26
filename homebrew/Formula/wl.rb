class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.19.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.19.0/wl-darwin-arm64"
      sha256 "bd923dcd19b933b12821150506a5c99771cf8b3bd95432c6814b64b9ff1f323c"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.19.0/wl-darwin-x86_64"
      sha256 "8c20a7cc31a9fd595a39deb8c7a75ecf5f7987fd9e9a807a2baf4221191ee039"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.19.0/wl-linux-arm64"
      sha256 "58d929572750527245534b929cc7ef36fe29773a43289a93e3eb37a3ec28f358"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.19.0/wl-linux-x86_64"
      sha256 "5769cdd22e1b4a2755633b309f74698d8a17fea72663532181dbc5f879848697"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "wl-darwin-arm64"
      else
        "wl-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "wl-linux-arm64"
      else
        "wl-linux-x86_64"
      end
    end

    bin.install binary_name => "wl"
  end

  test do
    system "#{bin}/wl", "--help"
  end
end
