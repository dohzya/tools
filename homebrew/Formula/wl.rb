class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.12.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.12.0/wl-darwin-arm64"
      sha256 "32ae0249fe6ed78b190b077177ce3d6d79f31b2762fbdea9162405085dee0825"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.12.0/wl-darwin-x86_64"
      sha256 "2b991e517cc69515cd45d3760b9c94c2fe9bba955fcdef9bf28102c19cffc094"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.12.0/wl-linux-arm64"
      sha256 "033bc6f00e88869f2e34538c4e23f28a1f03e8a8c2f3a9b5688f1c99be2f3040"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.12.0/wl-linux-x86_64"
      sha256 "5f19002662bae12531764b01532f07ab9f27291fc33d3647a23e65456056ba70"
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
