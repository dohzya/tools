class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.21.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.0/wl-darwin-arm64"
      sha256 "91145d18fbcbf82970e6767a22ebbc87cccedbb0795a3b5956893caf008cfe3c"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.0/wl-darwin-x86_64"
      sha256 "058a07103a1eb8696648f482f7848c1cd21504856b04150f0ba20aedbcd30963"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.0/wl-linux-arm64"
      sha256 "d67276b84487246f272ea2cbbc3a4c3e8c9964ccfbdb77da05d794525c3a1cbd"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.21.0/wl-linux-x86_64"
      sha256 "c0c7d3cc1b625c2eaaf1abf5e92fd948c46fbcc1bfe962658fc1290bf21636ec"
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
