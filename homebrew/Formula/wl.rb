class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.20.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.0/wl-darwin-arm64"
      sha256 "4ce2edd321cb66e042888c249f7184fe240e83e684adc39fa370d28a8bda4879"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.0/wl-darwin-x86_64"
      sha256 "0278ae262d5ce500d6a42e2fdd077d2e003e662108dfb584c03524b00c73003b"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.0/wl-linux-arm64"
      sha256 "d30f862eae8b7b129b04fcfb4ea14ba272b2f751a9bc81d95be0957cecfcc2b7"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.20.0/wl-linux-x86_64"
      sha256 "821083ac62fb62e747f26c3e921118c1c22bddb6b73eae6d0c716538da9acfb3"
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
