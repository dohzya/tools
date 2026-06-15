class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.18.5"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.5/wl-darwin-arm64"
      sha256 "a525f8e4f3b329cfb63fc5771b2b4ba91141733985573f2a575223132ada8ffa"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.5/wl-darwin-x86_64"
      sha256 "b77a4e57c289c8cc88272ab9d079edd635dc26d2adcbbc1580127acfa5904bad"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.5/wl-linux-arm64"
      sha256 "e95129d20e9bf23d34c1736ca5cec06c67186dd2a1731d117b2f87c2e4ceaad1"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.18.5/wl-linux-x86_64"
      sha256 "36548fa6c12f497d5051698e3be1df5145fcf5278c88775b2b2749459f5dcfc3"
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
