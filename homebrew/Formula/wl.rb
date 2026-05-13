class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.15.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.15.0/wl-darwin-arm64"
      sha256 "a27491ae2403b6923de3e534813ee5db2aadd4be1ab781796d2cdb591f30d3f7"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.15.0/wl-darwin-x86_64"
      sha256 "46b1a0985a5668c28b05b1d03749327906532a930194497262b260dfac1f17d1"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.15.0/wl-linux-arm64"
      sha256 "ff23f4bc8660d2452e1e1c4afbdf1c4bc7fc03284ab2226e5e3169fabb301b37"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.15.0/wl-linux-x86_64"
      sha256 "44c3b73303c3845b1b69fb08d1f5dda912b8ffcbfb9418dcc9e1b74662284bbe"
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
