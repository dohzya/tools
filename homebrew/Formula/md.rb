class Md < Formula
  desc "Markdown surgeon - powerful markdown file manipulation tool"
  homepage "https://github.com/dohzya/tools"
  version "0.10.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.0/md-darwin-arm64"
      sha256 "0a09db5770d579d374a326c8ae99426c4f93d13a6404996dee3efe4ec9a04fbc"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.0/md-darwin-x86_64"
      sha256 "dd2eee8674035105044ad5e217f80339776c9c5a721d15264240cd46a88a40ef"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.0/md-linux-arm64"
      sha256 "f1856b45c6ce9b76621664509ce6a7628b8917f9649f29410d3eb1c23294dd03"
    elsif Hardware::CPU.intel?
      url "https://github.com/dohzya/tools/releases/download/md-v0.10.0/md-linux-x86_64"
      sha256 "d8c5487b2b5285f1cf2e74db78c630a2a8d5cbf40dafdec2f05adc31e4ef971d"
    end
  end

  def install
    # Determine which binary was downloaded based on platform
    binary_name = if OS.mac?
      if Hardware::CPU.arm?
        "md-darwin-arm64"
      else
        "md-darwin-x86_64"
      end
    else
      if Hardware::CPU.arm?
        "md-linux-arm64"
      else
        "md-linux-x86_64"
      end
    end

    bin.install binary_name => "md"
  end

  test do
    system "#{bin}/md", "--help"
  end
end
