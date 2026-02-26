class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.11.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.11.0/wl-darwin-arm64"
      sha256 "0af2969a8a12563bc3b743c9e5846bf76e70da939b7d68711db97b4c78a9a3b2"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.11.0/wl-darwin-x86_64"
      sha256 "aac9279283eeba160e059f56470b824163f848141bfd9960ff5edecdac250dfb"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.11.0/wl-linux-arm64"
      sha256 "7b5c39e6912db75b896b01a9a465e32eabf2e259dc217baecdf8a4d2d60e71be"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.11.0/wl-linux-x86_64"
      sha256 "076173e741f35920fb5e37a949f1795c41afaaeeb4db44533ba94fbaf7a98940"
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
