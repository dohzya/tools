class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.13.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.13.0/wl-darwin-arm64"
      sha256 "9e4d446409e632c693c985050ac3db468fa1bf38a18be6a0abd22c68e2901eb2"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.13.0/wl-darwin-x86_64"
      sha256 "f040bbc1886ee2f470129716149a815d21315f3edfb61894ed8d27b2f6143ba1"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.13.0/wl-linux-arm64"
      sha256 "0d46f22dc2d5cd207090bc07f98d1d210274bd5d651a535a31a6c6e223df19a6"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.13.0/wl-linux-x86_64"
      sha256 "c03d7e888488f5121caa3caff7451fe57062553220960ec2b633fcd1e5bd4a1f"
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
