class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.14.2"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.2/wl-darwin-arm64"
      sha256 "ec1bde250dd6e089cb8ec35ff348e524121f0cc9e48c66576fbd33cd4aac7bdf"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.2/wl-darwin-x86_64"
      sha256 "14a1cf83e6eabd1fcbc52d3f522d53132dd461167a2b9ec65253c0ed1a10f8d9"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.2/wl-linux-arm64"
      sha256 "9c415e8127caddf8c9bde121203752a51505e610fe9f925462f30a219412cfbf"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.14.2/wl-linux-x86_64"
      sha256 "5b05cf1f0009b897906b68af5e857379d4dc878676fac840887bf32083e0e5d4"
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
