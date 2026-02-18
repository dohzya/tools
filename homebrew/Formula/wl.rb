class Wl < Formula
  desc "Worklog - track work progress during development sessions"
  homepage "https://github.com/dohzya/tools"
  version "0.8.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.8.0/wl-darwin-arm64"
      sha256 "b7c7e3ec5a0fe3b630d87b2a1cad4fdcadf0ef90708206e72b8e239a89a1018a"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.8.0/wl-darwin-x86_64"
      sha256 "ac2a671cb53723df653117c5b8a1192f52c86ec1b0d2d1b9b68642f8a7bbe199"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.8.0/wl-linux-arm64"
      sha256 "ea6c71c4361e465721244c1d13d1c14b3afc2afbcd02fb70a7b1e4d7983786c9"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/wl-v0.8.0/wl-linux-x86_64"
      sha256 "eee2088dc45d0e92efc0c4241bd66e4d61ad21d79ab864a3196b19b70cb87ba8"
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
